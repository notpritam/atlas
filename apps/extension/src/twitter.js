// Adds a FoundKeep destination-picker button to each X / Twitter action bar.
// Clicking it opens a sidebar review of this tweet; only confirmation saves it.
// The original author, text and permalink stay together. Self-contained script — all
// network goes through the background worker, so no token lives in the page.

const PRODUCT_NAME = chrome.runtime.getManifest().action.default_title;
// Keep dev outside the marker used by already-installed production releases.
const BUTTON_ATTRIBUTE = PRODUCT_NAME === "FoundKeep Dev" ? "data-foundkeep-dev" : "data-atlas";
const OWN_BUTTON = `[${BUTTON_ATTRIBUTE}="${chrome.runtime.id}"]`;
const MARK_SVG = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4z"/></svg>';
const CHECK_SVG = `<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const IDLE = "rgb(113, 118, 123)";
const ACCENT = "#0d7a50";

function extract(article) {
  const link = [...article.querySelectorAll('a[href*="/status/"]')].find((a) =>
    a.querySelector("time"),
  );
  const href = link?.getAttribute("href") || "";
  const m = href.match(/^\/([^/]+)\/status\/(\d+)/);
  if (!m) return null;
  const handle = m[1];
  const url = `https://x.com/${handle}/status/${m[2]}`;
  const name =
    article.querySelector('[data-testid="User-Name"]')?.innerText?.split("\n")[0]?.trim() ||
    handle;
  const text = article.querySelector('[data-testid="tweetText"]')?.innerText?.trim() || "";
  return {
    url,
    text,
    title: `${name} (@${handle}) on X`,
    favicon: "https://abs.twimg.com/favicons/twitter.3.ico",
  };
}

function setState(btn, state) {
  btn.dataset.state = state;
  if (state === "saving") {
    btn.style.color = ACCENT;
    btn.style.opacity = "0.6";
  } else if (state === "choosing") {
    btn.style.color = ACCENT; btn.style.opacity = "1";
    btn.title = "Choose a destination in the sidebar";
    btn.setAttribute("aria-label", btn.title);
  } else if (state === "saved") {
    btn.style.color = ACCENT;
    btn.style.background = "rgba(13,122,80,0.12)";
    btn.style.opacity = "1";
    btn.innerHTML = CHECK_SVG;
    btn.title = `Saved to ${PRODUCT_NAME}`;
    btn.setAttribute("aria-label", btn.title);
  } else if (state === "error") {
    btn.style.color = "#f4212e";
    btn.style.opacity = "1";
    btn.title = "Couldn't save — check the extension settings";
    setTimeout(() => {
      if (btn.dataset.state === "error") reset(btn);
    }, 2500);
  } else {
    reset(btn);
  }
}

function reset(btn) {
  btn.dataset.state = "idle";
  btn.style.color = IDLE;
  btn.style.background = "transparent";
  btn.style.opacity = "1";
  btn.innerHTML = MARK_SVG + (PRODUCT_NAME === "FoundKeep Dev" ? '<small style="font-size:9px;margin-left:2px">Dev</small>' : "");
  btn.title = `Choose where to save in ${PRODUCT_NAME}`;
  btn.setAttribute("aria-label", btn.title);
}

function makeButton() {
  const wrap = document.createElement("div");
  wrap.setAttribute(BUTTON_ATTRIBUTE, chrome.runtime.id);
  wrap.style.cssText = "display:flex;align-items:center;";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.style.cssText =
    "display:inline-flex;align-items:center;justify-content:center;width:34.75px;height:34.75px;padding:0;margin:0;border:0;background:transparent;border-radius:9999px;cursor:pointer;color:" +
    IDLE +
    ";transition:color .2s,background .2s,opacity .2s;";
  if (PRODUCT_NAME === "FoundKeep Dev") btn.style.width = "52px";
  reset(btn);

  btn.addEventListener("mouseenter", () => {
    if (btn.dataset.state === "saved") return;
    btn.style.color = ACCENT;
    btn.style.background = "rgba(13,122,80,0.1)";
  });
  btn.addEventListener("mouseleave", () => {
    if (btn.dataset.state === "saved") return;
    btn.style.color = IDLE;
    btn.style.background = "transparent";
  });

  btn.addEventListener("click", (e) => {
    if (!e.isTrusted) return;
    if (btn.dataset.state === "saving") return;
    e.preventDefault();
    e.stopPropagation();
    const article = btn.closest('article[data-testid="tweet"]');
    if (!article) return;
    const data = extract(article);
    if (!data) return setState(btn, "error");
    btn.dataset.tweetUrl = data.url;
    setState(btn, "saving");
    try {
      chrome.runtime.sendMessage({ kind: "saveTweet", payload: data }, (res) => {
        if (chrome.runtime.lastError || !res?.ok) return setState(btn, "error");
        setState(btn, res.pending ? "choosing" : "saved");
      });
    } catch {
      setState(btn, "error");
    }
  });

  wrap.appendChild(btn);
  return wrap;
}

function inject() {
  if (!featureEnabled) return;
  const groups = document.querySelectorAll(
    'article[data-testid="tweet"] div[role="group"]',
  );
  for (const g of groups) {
    if (g.querySelector(OWN_BUTTON)) continue;
    // Only the action bar (it has the reply button); skip metric-only groups.
    if (!g.querySelector('[data-testid="reply"]')) continue;
    g.appendChild(makeButton());
  }
}

// X is a virtualized SPA — re-run on DOM changes, throttled to a frame.
let queued = false,
  featureEnabled = false;
const observer = new MutationObserver(() => {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    inject();
  });
});

function refreshFeature() {
  chrome.runtime.sendMessage({ kind: "feature-status", feature: "tweet" }, (result) => {
    if (chrome.runtime.lastError) return;
    featureEnabled = result?.enabled !== false;
    if (!featureEnabled) document.querySelectorAll(OWN_BUTTON).forEach((node) => node.remove());
    observer.disconnect();
    if (featureEnabled) {
      observer.observe(document.body, { childList: true, subtree: true });
      inject();
    }
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.kind === "atlas-preferences-changed") refreshFeature();
  if (message?.kind === "foundkeep-tweet-result") {
    for (const button of document.querySelectorAll(OWN_BUTTON + ' button')) {
      if (button.dataset.tweetUrl === message.url) setState(button, message.cancelled ? 'idle' : 'saved');
    }
  }
});
refreshFeature();
