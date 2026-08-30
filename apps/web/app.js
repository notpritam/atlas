// Landing interactions: staggered scroll reveals (once), nav state, mobile menu.
// Motion is gentle and honors prefers-reduced-motion (cross-fade, no travel).
(() => {
  const nav = document.getElementById("nav");
  const toggle = document.getElementById("navToggle");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

  // Sticky nav gains a translucent background past the top.
  const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 8);
  onScroll();
  addEventListener("scroll", onScroll, { passive: true });

  // Mobile menu.
  toggle?.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
  });
  nav.querySelectorAll(".nav-links a").forEach((a) =>
    a.addEventListener("click", () => {
      nav.classList.remove("open");
      toggle?.setAttribute("aria-expanded", "false");
    }),
  );

  // Reveal on scroll — once, staggered by position among reveal siblings.
  const items = [...document.querySelectorAll(".reveal")];
  for (const el of items) {
    const sibs = [...el.parentElement.children].filter((c) => c.classList.contains("reveal"));
    const i = sibs.indexOf(el);
    if (i > 0) el.style.transitionDelay = `${Math.min(i, 6) * 55}ms`;
  }

  if (reduce.matches || !("IntersectionObserver" in window)) {
    items.forEach((el) => el.classList.add("in"));
  } else {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.1 },
    );
    items.forEach((el) => io.observe(el));
  }

  const y = document.getElementById("year");
  if (y) y.textContent = String(new Date().getFullYear());
})();
