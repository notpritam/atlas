'use client';
import { useEffect, useRef, type ReactNode } from 'react';

export function AnimatedFaq({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const active = new Map<HTMLDetailsElement, { animation: Animation; opening: boolean }>();
    const click = (event: MouseEvent) => {
      const summary = (event.target as Element).closest('summary');
      const details = summary?.parentElement;
      if (!(details instanceof HTMLDetailsElement) || !root.contains(details)) return;
      event.preventDefault();
      const previous = active.get(details);
      const opening = previous ? !previous.opening : !details.open;
      const from = details.getBoundingClientRect().height;
      previous?.animation.cancel();
      active.delete(details);
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) { details.open = opening; return; }
      details.open = true;
      const to = opening ? details.getBoundingClientRect().height : summary!.getBoundingClientRect().height + 1;
      const animation = details.animate({ height: [`${from}px`, `${to}px`] }, { duration: 240, easing: 'cubic-bezier(.16,1,.3,1)' });
      active.set(details, { animation, opening });
      animation.onfinish = () => { details.open = opening; active.delete(details); };
    };
    root.addEventListener('click', click);
    return () => { root.removeEventListener('click', click); active.forEach(({ animation }) => animation.cancel()); };
  }, []);
  return <div className="faq-list" ref={ref}>{children}</div>;
}
