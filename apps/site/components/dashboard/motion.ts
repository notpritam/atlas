'use client';

import { useRef, type RefObject } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(useGSAP);
export { gsap, useGSAP };
export const motionAllowed = '(prefers-reduced-motion: no-preference)';

/** Content is visible before hydration; every animation belongs to its component. */
export function useEntrance<T extends HTMLElement>(key: unknown = true, selector?: string, axis: 'x' | 'y' = 'y') {
  const ref = useRef<T>(null);
  useGSAP(() => {
    if (!key || !ref.current) return;
    const media = gsap.matchMedia();
    media.add(motionAllowed, () => {
      const targets = selector ? Array.from(ref.current!.querySelectorAll(selector)) : [ref.current];
      if (!targets.length) return;
      gsap.from(targets, { opacity: 0, [axis]: 12, duration: 0.32, stagger: { amount: 0.18 }, ease: 'power2.out', clearProps: 'transform,opacity' });
    });
    return () => media.revert();
  }, { scope: ref, dependencies: [key, selector, axis], revertOnUpdate: true });
  return ref;
}

export function useCardMotion() {
  const ref = useRef<HTMLElement>(null);
  useGSAP(() => {
    const element = ref.current;
    if (!element) return;
    const media = gsap.matchMedia();
    media.add(`${motionAllowed} and (hover: hover) and (pointer: fine)`, () => {
      const hover = gsap.to(element, { y: -3, duration: 0.18, ease: 'power2.out', paused: true });
      const enter = () => hover.play();
      const leave = () => hover.reverse();
      element.addEventListener('pointerenter', enter);
      element.addEventListener('pointerleave', leave);
      element.addEventListener('pointerdown', leave);
      return () => {
        element.removeEventListener('pointerenter', enter);
        element.removeEventListener('pointerleave', leave);
        element.removeEventListener('pointerdown', leave);
      };
    });
    return () => media.revert();
  }, { scope: ref });
  return ref;
}

/** Only visible, active work runs a loop. Hidden tabs and offscreen previews pause. */
export function useLoadingLoop(ref: RefObject<HTMLElement | null>, active: boolean, kind: 'spin' | 'shimmer') {
  useGSAP(() => {
    const element = ref.current;
    if (!active || !element) return;
    const media = gsap.matchMedia();
    media.add(motionAllowed, () => {
      const tween = kind === 'spin'
        ? gsap.to(element, { rotation: 360, duration: 0.85, repeat: -1, ease: 'none', paused: true })
        : gsap.fromTo(element, { xPercent: -110 }, { xPercent: 330, duration: 1.45, repeat: -1, repeatDelay: 0.25, ease: 'none', paused: true });
      let visible = false;
      const update = () => { if (visible && !document.hidden) tween.resume(); else tween.pause(); };
      const observer = new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); update(); });
      observer.observe(element.parentElement || element);
      document.addEventListener('visibilitychange', update);
      return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update); };
    });
    return () => media.revert();
  }, { scope: ref, dependencies: [active, kind], revertOnUpdate: true });
}
