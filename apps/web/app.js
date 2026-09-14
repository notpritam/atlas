const saveButton = document.querySelector("#demoSave");
const resetButton = document.querySelector("#demoReset");

function setDemoSaved(saved) {
  document.querySelector("#demoEmpty").hidden = saved;
  document.querySelector("#demoSaved").hidden = !saved;
  document.querySelector("#demoCount").textContent = saved
    ? "1 item"
    : "0 items";
  document.querySelector("#demo-selection").classList.toggle("is-saved", saved);
  saveButton.disabled = saved;
  document.querySelector("#demoStatus").textContent = saved
    ? "Highlight saved in this illustration. Your FoundKeep library has not changed."
    : "Try it here. This demo does not save to your FoundKeep library.";
  // Move focus to the next useful action when its previous control disappears.
  (saved ? resetButton : saveButton).focus({ preventScroll: true });
}

saveButton?.addEventListener("click", () => setDemoSaved(true));
resetButton?.addEventListener("click", () => setDemoSaved(false));

// Installation is detected by a real extension response, never a cached claim.
import("./customer.js?v=20260910-platforms")
  .then(async ({ customerConfig, extensionMessage, renderIphoneLinks, isIphoneBrowser }) => {
    const config = await customerConfig();
    renderIphoneLinks(config);
    if (isIphoneBrowser()) {
      const actions = document.querySelector(".hero-device-actions");
      const iphone = actions?.querySelector("[data-iphone-install]");
      if (iphone) actions.prepend(iphone);
      const platforms = document.querySelector(".platform-grid");
      const phone = platforms?.querySelector(".phone-platform");
      if (phone) platforms.prepend(phone);
    }
    const installs = [...document.querySelectorAll("[data-extension-install]")];
    const note = document.querySelector(".download-note");
    if (!installs.length) return;
    const pendingInstall = "foundkeep-install-return";
    let checkSequence = 0;
    const render = (extension) => {
      for (const install of installs) {
        const label = install.querySelector("[data-extension-label]") || install;
        if (extension) {
          install.href = "dashboard.html";
          install.removeAttribute("target");
          install.removeAttribute("download");
          label.textContent = extension.account ? "Open dashboard" : "Connect extension";
        } else if (config.storeUrl) {
          install.href = config.storeUrl;
          install.removeAttribute("download");
          install.target = "_blank";
          install.rel = "noopener noreferrer";
          label.textContent = "Add to Chrome";
        }
      }
      if (note) note.textContent = extension
        ? extension.account
          ? "FoundKeep is installed and connected in this browser."
          : "FoundKeep is installed. Connect your account to sync your saves."
        : "Available now in the Chrome Web Store · Version 1.0.0 · Automatic updates";
    };
    const check = async () => {
      const current = ++checkSequence;
      let extension = null;
      try {
        // An unavailable legacy installation must not delay a working Store one.
        extension = await Promise.any(config.extensionIds.map(id => extensionMessage({ kind: "atlas-ping" }, id)));
      } catch { /* A missing or disabled extension keeps the install links. */ }
      if (current === checkSequence) render(extension);
    };
    const recheck = () => {
      if (document.visibilityState === "hidden") return;
      let pending = false;
      try {
        const started = Number(sessionStorage.getItem(pendingInstall));
        pending = started > Date.now() - 30 * 60 * 1000;
        sessionStorage.removeItem(pendingInstall);
      } catch { /* Detection also works when browser storage is unavailable. */ }
      // Chrome may expose external messaging only after a document reload when
      // an extension is installed in another tab. Reload once after an explicit
      // Store visit; do not loop or reload ordinary returning visitors.
      if (pending && !globalThis.chrome?.runtime?.sendMessage) {
        location.reload();
        return;
      }
      void check();
    };
    for (const install of installs) install.addEventListener("click", () => {
      if (install.href !== config.storeUrl) return;
      try { sessionStorage.setItem(pendingInstall, String(Date.now())); } catch {}
    });
    window.addEventListener("focus", recheck);
    window.addEventListener("pageshow", recheck);
    document.addEventListener("visibilitychange", recheck);
    render(null);
    void check();
  })
  .catch(() => { /* Static Store and manual ZIP links remain available. */ });

// The compact menu is progressively enhanced; without JS, hero and footer links remain usable.
const menuToggle = document.querySelector(".menu-toggle");
const mobileNav = document.querySelector("#mobile-nav");
if (menuToggle && mobileNav) {
  menuToggle.hidden = false;
  const closeMenu = (restoreFocus = false) => {
    mobileNav.hidden = true;
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "Open navigation");
    if (restoreFocus) menuToggle.focus();
  };
  menuToggle.addEventListener("click", () => {
    const open = menuToggle.getAttribute("aria-expanded") !== "true";
    mobileNav.hidden = !open;
    menuToggle.setAttribute("aria-expanded", String(open));
    menuToggle.setAttribute(
      "aria-label",
      open ? "Close navigation" : "Open navigation",
    );
  });
  mobileNav.addEventListener("click", (event) => {
    if (event.target.closest("a")) closeMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !mobileNav.hidden) closeMenu(true);
  });
  document.addEventListener("click", (event) => {
    if (
      !mobileNav.hidden &&
      !mobileNav.contains(event.target) &&
      !menuToggle.contains(event.target)
    )
      closeMenu();
  });
  const desktop = matchMedia("(min-width: 541px)");
  desktop.addEventListener("change", (event) => {
    if (event.matches) closeMenu();
  });
}
