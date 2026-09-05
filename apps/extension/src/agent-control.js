// Atlas agent-control content script.
// Renders a small floating "Agent" button; when you enable it, this tab accepts
// commands from your agent (via the background bridge) and acts on the page:
// snapshot, click, type, fill, select, scroll, read text, wait. Actions flash a
// highlight AND move a floating "agent cursor" so you can watch what it touches.
// When the background has the Chrome debugger attached, clicks/keys are dispatched
// as real (trusted) input via CDP; this script still handles structure + reads.
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
    #atlas-agent-cursor{position:fixed;left:0;top:0;z-index:2147483644;pointer-events:none;display:none;
      transform:translate(-200px,-200px);transition:transform .19s cubic-bezier(.22,1,.36,1)}
    #atlas-agent-cursor.on{display:block}
    #atlas-agent-cursor .cur{position:relative;filter:drop-shadow(0 0 6px rgba(139,123,255,.6)) drop-shadow(0 2px 4px rgba(0,0,0,.4));
      animation:atlasFloat 2.4s ease-in-out infinite;transform-origin:5px 4px}
    #atlas-agent-cursor.tap .cur{animation:atlasTap .32s ease}
    @keyframes atlasFloat{0%,100%{transform:translateY(0) rotate(0)}50%{transform:translateY(-1.5px) rotate(-3deg)}}
    @keyframes atlasTap{0%{transform:scale(1)}45%{transform:scale(.8)}100%{transform:scale(1)}}
    #atlas-agent-cursor .halo{position:absolute;left:-6px;top:-6px;width:20px;height:20px;border-radius:50%;
      background:radial-gradient(circle,rgba(139,123,255,.55),transparent 70%);animation:atlasHalo 2.4s ease-in-out infinite}
    @keyframes atlasHalo{0%,100%{opacity:.5;transform:scale(1)}50%{opacity:.9;transform:scale(1.25)}}
    #atlas-agent-cursor .tag{position:absolute;left:21px;top:15px;background:linear-gradient(90deg,#8b7bff,#58c7ff);color:#fff;
      font:700 10px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:3px 7px;border-radius:999px;white-space:nowrap;
      box-shadow:0 4px 12px rgba(139,123,255,.45);letter-spacing:.03em}
    #atlas-agent-ring{position:absolute;left:-4px;top:-4px;width:28px;height:28px;border-radius:50%;border:2px solid #8b7bff;opacity:0}
    #atlas-agent-ring.go{animation:atlasRing .55s ease-out}
    @keyframes atlasRing{0%{opacity:.9;transform:scale(.3)}100%{opacity:0;transform:scale(2)}}
    #atlas-agent-caret{position:absolute;left:3px;top:-3px;width:2px;height:15px;background:#8b7bff;border-radius:1px;opacity:0;box-shadow:0 0 6px #8b7bff}
    #atlas-agent-cursor.typing #atlas-agent-caret{opacity:1;animation:atlasCaret .8s steps(1) infinite}
    @keyframes atlasCaret{0%,100%{opacity:1}50%{opacity:.12}}
    .atlas-agent-trail{position:fixed;z-index:2147483643;pointer-events:none;width:8px;height:8px;border-radius:50%;
      background:radial-gradient(circle,rgba(139,123,255,.85),transparent 70%);transition:opacity .5s ease,transform .5s ease}
  `;
  document.documentElement.appendChild(style);

  const frame = document.createElement("div");
  frame.id = "atlas-agent-frame";
  const pill = document.createElement("div");
  pill.id = "atlas-agent-pill";
  pill.innerHTML = `<span class="dot"></span><span class="lbl">Agent</span>`;
  const cursor = document.createElement("div");
  cursor.id = "atlas-agent-cursor";
  cursor.innerHTML =
    `<span class="halo"></span>` +
    `<span class="cur"><svg width="22" height="26" viewBox="0 0 22 26" fill="none" aria-hidden="true">` +
    `<defs><linearGradient id="atlasCurG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a99bff"/><stop offset="1" stop-color="#58c7ff"/></linearGradient></defs>` +
    `<path d="M5 3v16l4-4 2.6 5.6 2.4-1L11.4 14H17z" fill="url(#atlasCurG)" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>` +
    `<span id="atlas-agent-ring"></span><span id="atlas-agent-caret"></span></span>` +
    `<span class="tag">Agent</span>`;
  const attach = () => { if (document.body) { document.body.append(frame, cursor, pill); } };
  if (document.body) attach(); else document.addEventListener("DOMContentLoaded", attach);

  let curX = -200, curY = -200;
  let lastAgentActionAt = 0;
  const markAgent = () => { lastAgentActionAt = Date.now(); };
  function spawnTrail(x, y) {
    const d = document.createElement("div"); d.className = "atlas-agent-trail";
    d.style.left = (x - 4) + "px"; d.style.top = (y - 4) + "px";
    (document.body || document.documentElement).appendChild(d);
    requestAnimationFrame(() => { d.style.opacity = "0"; d.style.transform = "scale(.3)"; });
    setTimeout(() => d.remove(), 520);
  }
  function moveCursor(x, y) {
    if (x == null || y == null) return;
    if (Math.hypot(x - curX, y - curY) > 26) spawnTrail(curX, curY);
    curX = x; curY = y; cursor.style.transform = `translate(${x}px, ${y}px)`;
  }
  function moveToEl(el) { if (!el) return; const r = el.getBoundingClientRect(); moveCursor(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)); }
  function setLabel(t) { const tag = cursor.querySelector(".tag"); if (tag) tag.textContent = t || "Agent"; }
  function setTyping(on) { cursor.classList.toggle("typing", !!on); }
  function clickPulse() {
    const ring = cursor.querySelector("#atlas-agent-ring");
    if (ring) { ring.classList.remove("go"); void ring.offsetWidth; ring.classList.add("go"); }
    cursor.classList.remove("tap"); void cursor.offsetWidth; cursor.classList.add("tap");
  }

  function setControlling(on) {
    controlling = on;
    pill.classList.toggle("on", on);
    frame.classList.toggle("on", on);
    cursor.classList.toggle("on", on);
    pill.querySelector(".lbl").textContent = on ? "Agent · on" : "Agent";
    chrome.runtime.sendMessage({ k: "agent-toggle", on });
    if (on) scheduleCtx();
  }
  pill.addEventListener("click", () => setControlling(!controlling));

  chrome.storage?.local?.get?.(["agentMode"], (s) => {
    if (s && s.agentMode === false) { pill.style.display = "none"; frame.style.display = "none"; cursor.style.display = "none"; }
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

  // move the agent cursor to a ref, scroll it into view, return viewport centre
  // coords so the background can dispatch real CDP input there.
  function locate(ref) {
    const el = need(ref);
    el.scrollIntoView({ block: "center", inline: "center" });
    const r = el.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    markAgent(); moveCursor(x, y); flash(el);
    return { x, y, name: nameOf(el) };
  }

  async function typeInto(el, text, { submit, clear }) {
    markAgent(); el.scrollIntoView({ block: "center" }); moveToEl(el); setTyping(true); setLabel("typing…"); el.focus?.(); flash(el);
    if (el.isContentEditable) { if (clear) el.textContent = ""; document.execCommand("insertText", false, text); }
    else setNativeValue(el, (clear ? "" : el.value || "") + text);
    if (submit) el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    if (submit && el.form) el.form.requestSubmit?.();
    setTyping(false); setLabel("Agent");
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

  // ---- live context streaming + user/agent interaction tracking -----------
  // The agent gets fresh page context without polling, and every interaction is
  // logged with WHO did it — so it knows when you use the site alongside it.
  let ctxTimer = 0;
  function pushContext() { if (!controlling) return; try { chrome.runtime.sendMessage({ k: "agent-context", ctx: snapshot() }); } catch { /* noop */ } }
  function scheduleCtx() { clearTimeout(ctxTimer); ctxTimer = setTimeout(pushContext, 450); }
  const actorNow = () => (Date.now() - lastAgentActionAt < 700 ? "agent" : "user");
  function logActivity(type, detail) {
    if (!controlling) return;
    try { chrome.runtime.sendMessage({ k: "agent-activity", ev: { actor: actorNow(), type, detail: String(detail || "").slice(0, 120), url: location.href, at: Date.now() } }); } catch { /* noop */ }
    scheduleCtx();
  }
  document.addEventListener("click", (e) => { const t = e.target; logActivity("click", t && (nameOf(t) || t.tagName)); }, true);
  document.addEventListener("input", (e) => { const t = e.target; const v = t && "value" in t ? ` = "${String(t.value).slice(0, 40)}"` : ""; logActivity("input", (t && (nameOf(t) || t.tagName) || "") + v); }, true);
  document.addEventListener("change", (e) => { const t = e.target; logActivity("change", t && (nameOf(t) || t.tagName)); }, true);
  let scrollTimer = 0;
  document.addEventListener("scroll", () => { clearTimeout(scrollTimer); scrollTimer = setTimeout(() => logActivity("scroll", `y=${Math.round(window.scrollY)}`), 250); }, true);
  window.addEventListener("load", () => scheduleCtx());
  try { new MutationObserver(scheduleCtx).observe(document.documentElement, { subtree: true, childList: true, characterData: true }); } catch { /* noop */ }

  // ---- command handler ----------------------------------------------------
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.k !== "agent-cmd") return;
    // cursor + locate are internal (from the background) and allowed even to
    // reflect what a real-input CDP action is about to touch.
    if (msg.action === "cursor") {
      markAgent();
      const p = msg.params || {};
      if (p.label !== undefined) setLabel(p.label);
      if (p.typing !== undefined) setTyping(p.typing);
      moveCursor(p.x, p.y);
      if (p.click) clickPulse();
      sendResponse({ ok: true, data: "moved" }); return true;
    }
    if (!controlling) { sendResponse({ ok: false, error: "This tab is not under agent control — click the floating Agent button." }); return true; }
    (async () => {
      try {
        const { action, params = {} } = msg;
        switch (action) {
          case "snapshot": return sendResponse({ ok: true, data: snapshot() });
          case "locate": return sendResponse({ ok: true, data: locate(params.ref) });
          case "getText": {
            const el = params.ref != null ? need(params.ref) : document.body;
            return sendResponse({ ok: true, data: (el.innerText || "").trim().slice(0, 8000) });
          }
          case "click": { const el = need(params.ref); markAgent(); el.scrollIntoView({ block: "center" }); moveToEl(el); setLabel(`clicking ${nameOf(el) || el.tagName}`); flash(el); clickPulse(); el.click(); setTimeout(() => setLabel("Agent"), 900); return sendResponse({ ok: true, data: `clicked ${nameOf(el) || el.tagName}` }); }
          case "type": { await typeInto(need(params.ref), params.text ?? "", params); return sendResponse({ ok: true, data: "typed" }); }
          case "fill": { for (const f of params.fields || []) await typeInto(need(f.ref), f.value ?? "", { clear: true }); return sendResponse({ ok: true, data: `filled ${params.fields?.length || 0} field(s)` }); }
          case "select": {
            const el = need(params.ref); moveToEl(el); flash(el);
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
