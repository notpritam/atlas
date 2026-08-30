// Landing page interactions — reveal-on-scroll, nav state, mobile menu.
(() => {
  const nav = document.getElementById("nav");
  const toggle = document.getElementById("navToggle");

  // Sticky nav gets a background once you scroll past the hero top.
  const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 12);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

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

  // Reveal on scroll.
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const items = document.querySelectorAll(".reveal");
  if (reduce || !("IntersectionObserver" in window)) {
    items.forEach((el) => el.classList.add("in"));
  } else {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.14, rootMargin: "0px 0px -8% 0px" },
    );
    items.forEach((el) => io.observe(el));

    // Gentle parallax on the aurora blobs.
    const blobs = document.querySelectorAll(".blob");
    let ticking = false;
    window.addEventListener(
      "scroll",
      () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          const y = window.scrollY;
          blobs.forEach((b, i) => {
            b.style.transform = `translateY(${y * (0.02 + i * 0.015)}px)`;
          });
          ticking = false;
        });
      },
      { passive: true },
    );
  }

  document.getElementById("year").textContent = String(new Date().getFullYear());
})();
