// Atlas agent-control content script.
// Renders a small floating "Agent" button; when you enable it, this tab accepts
// commands from your agent (via the background bridge) and acts on the page:
// snapshot, click, type, fill, select, scroll, read text, wait. Actions flash a
// highlight so you can see what the agent touched.
(() => {
  if (window.__atlasAgentInstalled) return;
  window.__atlasAgentInstalled = true;

  let controlling = false;
  let refs = []; // index -> element, rebuilt on each snapshot

  // ---- visual feedback ----------------------------------------------------
  const style = document.createElement("style");
  style.textContent = `
    #atlas-agent-pill{position:fixed;z-index:2147483646;right:16px;bottom:16px;display:flex;align-items:center;gap:6px;
      padding:7px 11px;border-radius:999px;font:12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e8e8ee;
      background:rgba(17,18,24,.82);border:1px solid rgba(255,255,255,.12);backdrop-filter:blur(12px);cursor:pointer;
      box-shadow:0 8px 24px rgba(0,0,0,.4);user-select:none;transition:all .15s}
    #atlas-agent-pill:hover{border-color:rgba(139,123,255,.6)}
    #atlas-agent-pill.on{background:linear-gradient(90deg,rgba(139,123,255,.25),rgba(88,199,255,.18));border-color:rgba(139,123,255,.7)}
    #atlas-agent-pill .dot{width:8px;height:8px;border-radius:50%;background:#6b6b78}
    #atlas-agent-pill.on .dot{background:#8b7bff;box-shadow:0 0 8px #8b7bff;animation:atlasPulse 1.6s infinite}
    @keyframes atlasPulse{0%,100%{opacity:1}50%{opacity:.4}}
    #atlas-agent-frame{position:fixed;inset:0;z-index:2147483645;pointer-events:none;border:2px solid rgba(139,123,255,.55);border-radius:6px;display:none}
    #atlas-agent-frame.on{display:block}
    .atlas-agent-flash{outline:2px solid #8b7bff !important;outline-offset:2px;transition:outline .2s}
  `;
  document.documentElement.appendChild(style);

  const frame = document.createElement("div");
  frame.id = "atlas-agent-frame";
  const pill = document.createElement("div");
  pill.id = "atlas-agent-pill";
  pill.innerHTML = `<span class="dot"></span><span class="lbl">Agent</span>`;
  const attach = () => { if (document.body) { document.body.append(frame, pill); } };
  if (document.body) attach(); else document.addEventListener("DOMContentLoaded", attach);

  function setControlling(on) {
    controlling = on;
    pill.classList.toggle("on", on);
    frame.classList.toggle("on", on);
    pill.querySelector(".lbl").textContent = on ? "Agent · on" : "Agent";
    chrome.runtime.sendMessage({ k: "agent-toggle", on });
  }
  pill.addEventListener("click", () => setControlling(!controlling));

  chrome.storage?.local?.get?.(["agentMode"], (s) => {
    if (s && s.agentMode === false) { pill.style.display = "none"; frame.style.display = "none"; }
  });

  // Restore control if this tab was already granted before a reload/navigation —
  // the background bridge remembers the granted tab, so the agent keeps the tab
  // across every page it drives instead of dropping control on each page load.
  try {
    chrome.runtime.sendMessage({ k: "agent-hello" }, (resp) => {
      if (chrome.runtime.lastError) return;
      if (resp && resp.on && !controlling) setControlling(true);
    });
  } catch { /* noop */ }

  function flash(el) {
    if (!el) return;
    el.classList.add("atlas-agent-flash");
    setTimeout(() => el.classList.remove("atlas-agent-flash"), 500);
  }

  // ---- helpers ------------------------------------------------------------
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none" && st.opacity !== "0";
  };
  const nameOf = (el) =>
    (el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("name") ||
     el.getAttribute("title") || el.value || (el.innerText || "").trim() || el.getAttribute("alt") || "")
      .replace(/\s+/g, " ").slice(0, 80);

  function snapshot() {
    refs = [];
    const sel = 'a,button,input,textarea,select,[role="button"],[role="link"],[role="tab"],[role="checkbox"],[role="menuitem"],[onclick],summary,[contenteditable="true"]';
    const out = [];
    for (const el of document.querySelectorAll(sel)) {
      if (!visible(el)) continue;
      const ref = refs.length;
      refs.push(el);
      out.push({
        ref,
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute("type") || undefined,
        role: el.getAttribute("role") || undefined,
        name: nameOf(el),
      });
      if (out.length >= 200) break;
    }
    const text = (document.body?.innerText || "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 6000);
    return { url: location.href, title: document.title, elements: out, text };
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const need = (ref) => { const el = refs[ref]; if (!el) throw new Error(`No element for ref ${ref} — call browser_snapshot again.`); return el; };

  async function typeInto(el, text, { submit, clear }) {
    el.scrollIntoView({ block: "center" }); el.focus?.(); flash(el);
    if (el.isContentEditable) { if (clear) el.textContent = ""; document.execCommand("insertText", false, text); }
    else setNativeValue(el, (clear ? "" : el.value || "") + text);
    if (submit) el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    if (submit && el.form) el.form.requestSubmit?.();
  }

  function waitFor(selector, timeoutMs) {
    return new Promise((resolve) => {
      if (!selector) return resolve({ found: true });
      const end = Date.now() + (timeoutMs || 8000);
      const tick = () => {
        if (document.querySelector(selector)) return resolve({ found: true });
        if (Date.now() > end) return resolve({ found: false, timedOut: true });
        setTimeout(tick, 120);
      };
      tick();
    });
  }

  // ---- command handler ----------------------------------------------------
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.k !== "agent-cmd") return;
    if (!controlling) { sendResponse({ ok: false, error: "This tab is not under agent control — click the floating Agent button." }); return true; }
    (async () => {
      try {
        const { action, params = {} } = msg;
        switch (action) {
          case "snapshot": return sendResponse({ ok: true, data: snapshot() });
          case "getText": {
            const el = params.ref != null ? need(params.ref) : document.body;
            return sendResponse({ ok: true, data: (el.innerText || "").trim().slice(0, 8000) });
          }
          case "click": { const el = need(params.ref); el.scrollIntoView({ block: "center" }); flash(el); el.click(); return sendResponse({ ok: true, data: `clicked ${nameOf(el) || el.tagName}` }); }
          case "type": { await typeInto(need(params.ref), params.text ?? "", params); return sendResponse({ ok: true, data: "typed" }); }
          case "fill": { for (const f of params.fields || []) await typeInto(need(f.ref), f.value ?? "", { clear: true }); return sendResponse({ ok: true, data: `filled ${params.fields?.length || 0} field(s)` }); }
          case "select": {
            const el = need(params.ref); flash(el);
            const opt = [...el.options].find((o) => o.value === params.value || o.text.trim() === params.value) || [...el.options].find((o) => o.text.toLowerCase().includes(String(params.value).toLowerCase()));
            if (!opt) return sendResponse({ ok: false, error: `No option matching "${params.value}"` });
            el.value = opt.value; el.dispatchEvent(new Event("change", { bubbles: true }));
            return sendResponse({ ok: true, data: `selected ${opt.text}` });
          }
          case "scroll": {
            const d = params.direction;
            if (params.y != null) window.scrollTo({ top: params.y, behavior: "smooth" });
            else if (d === "top") window.scrollTo({ top: 0, behavior: "smooth" });
            else if (d === "bottom") window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
            else window.scrollBy({ top: (d === "up" ? -1 : 1) * window.innerHeight * 0.85, behavior: "smooth" });
            return sendResponse({ ok: true, data: `scrolled ${d ?? "to " + params.y}` });
          }
          case "key": {
            const el = document.activeElement || document.body;
            el.dispatchEvent(new KeyboardEvent("keydown", { key: params.key, bubbles: true }));
            el.dispatchEvent(new KeyboardEvent("keyup", { key: params.key, bubbles: true }));
            return sendResponse({ ok: true, data: `pressed ${params.key}` });
          }
          case "waitFor": return sendResponse({ ok: true, data: await waitFor(params.selector, params.timeoutMs) });
          default: return sendResponse({ ok: false, error: `Unknown action ${action}` });
        }
      } catch (e) { sendResponse({ ok: false, error: String(e?.message || e) }); }
    })();
    return true; // async
  });
})();
