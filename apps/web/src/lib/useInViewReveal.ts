import { useEffect, useRef, useState } from "react";

// Scroll-driven counterpart to OrgChartScreen's timer-driven useRevealStage:
// same idea (a boolean feeding pure CSS class lookups, never an animation
// library), but triggered by scroll position instead of a timeout. Starts
// `false` unconditionally — checking prefers-reduced-motion (or anything
// touching `window`) in the useState initializer would run during SSR too,
// where `window.matchMedia` doesn't exist and the value would necessarily
// differ from the client's, producing a hydration mismatch. useRevealStage
// sidesteps the identical problem by only ever reading matchMedia inside
// useEffect (client-only, post-hydration); this hook does the same.
export function useInViewReveal<T extends HTMLElement>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setRevealed(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setRevealed(true);
          observer.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, revealed];
}
