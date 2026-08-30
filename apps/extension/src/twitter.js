// Injects a "Save to Atlas" button into every X / Twitter tweet action bar,
// next to reply / repost / like / bookmark. Clicking it saves the tweet (author,
// text, permalink) to Atlas as a highlight. Self-contained content script — all
// network goes through the background worker, so no token lives in the page.

const MARK_SVG = `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="7" x2="6.5" y2="17"/><line x1="12" y1="7" x2="17.5" y2="17"/><line x1="6.5" y1="17" x2="17.5" y2="17"/></g><g fill="currentColor"><circle cx="12" cy="6.4" r="2.5"/><circle cx="6.2" cy="17.2" r="2"/><circle cx="17.8" cy="17.2" r="2"/></g></svg>`;
const CHECK_SVG = `<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const IDLE = "rgb(113, 118, 123)";
const ACCENT = "#6366f1";

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
  } else if (state === "saved") {
    btn.style.color = ACCENT;
    btn.style.background = "rgba(99,102,241,0.12)";
    btn.style.opacity = "1";
    btn.innerHTML = CHECK_SVG;
    btn.title = "Saved to Atlas";
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
  btn.innerHTML = MARK_SVG;
  btn.title = "Save to Atlas";
}

function makeButton() {
  const wrap = document.createElement("div");
  wrap.setAttribute("data-atlas", "1");
  wrap.style.cssText = "display:flex;align-items:center;";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.style.cssText =
    "display:inline-flex;align-items:center;justify-content:center;width:34.75px;height:34.75px;padding:0;margin:0;border:0;background:transparent;border-radius:9999px;cursor:pointer;color:" +
    IDLE +
    ";transition:color .2s,background .2s,opacity .2s;";
  reset(btn);

  btn.addEventListener("mouseenter", () => {
    if (btn.dataset.state === "saved") return;
    btn.style.color = ACCENT;
    btn.style.background = "rgba(99,102,241,0.1)";
  });
  btn.addEventListener("mouseleave", () => {
    if (btn.dataset.state === "saved") return;
    btn.style.color = IDLE;
    btn.style.background = "transparent";
  });

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const article = btn.closest('article[data-testid="tweet"]');
    if (!article) return;
    const data = extract(article);
    if (!data) return setState(btn, "error");
    setState(btn, "saving");
    try {
      chrome.runtime.sendMessage({ kind: "saveTweet", payload: data }, (res) => {
        if (chrome.runtime.lastError || !res?.ok) return setState(btn, "error");
        setState(btn, "saved");
      });
    } catch {
      setState(btn, "error");
    }
  });

  wrap.appendChild(btn);
  return wrap;
}

function inject() {
  const groups = document.querySelectorAll(
    'article[data-testid="tweet"] div[role="group"]',
  );
  for (const g of groups) {
    if (g.querySelector("[data-atlas]")) continue;
    // Only the action bar (it has the reply button); skip metric-only groups.
    if (!g.querySelector('[data-testid="reply"]')) continue;
    g.appendChild(makeButton());
  }
}

// X is a virtualized SPA — re-run on DOM changes, throttled to a frame.
let queued = false;
const observer = new MutationObserver(() => {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    inject();
  });
});
observer.observe(document.body, { childList: true, subtree: true });
inject();
