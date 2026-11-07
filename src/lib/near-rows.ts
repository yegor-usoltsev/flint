import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

export interface Nearness {
  height?: number;
  near: boolean;
}

const observers = new WeakMap<Document | Element, IntersectionObserver>();
const listeners = new WeakMap<Element, (nearness: Nearness) => void>();

const observerOf = (root: Document | Element) => {
  const existing = observers.get(root);

  if (existing !== undefined) {
    return existing;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const { boundingClientRect, isIntersecting, target } of entries) {
        listeners.get(target)?.(
          isIntersecting
            ? { near: true }
            : { height: boundingClientRect.height, near: false }
        );
      }
    },
    { root, rootMargin: "100% 0px" }
  );

  observers.set(root, observer);

  return observer;
};

const watchNearness = (
  element: Element,
  onChange: (nearness: Nearness) => void
) => {
  const observer = observerOf(element.closest("[data-rows]") ?? document);

  const recheck = () => {
    observer.unobserve(element);
    observer.observe(element);
  };

  listeners.set(element, onChange);
  observer.observe(element);
  element.addEventListener("focusout", recheck);

  return () => {
    observer.unobserve(element);
    listeners.delete(element);
    element.removeEventListener("focusout", recheck);
  };
};

export const useNearRows = (
  element: RefObject<Element | null>,
  initial: boolean
) => {
  const [nearness, setNearness] = useState<Nearness>({ near: initial });
  const near = useRef(initial);

  useEffect(() => {
    const target = element.current;

    return target === null
      ? undefined
      : watchNearness(target, (next) => {
          const kept = !next.near && target.contains(document.activeElement);

          if (next.near !== near.current && !kept) {
            near.current = next.near;
            setNearness(next);
          }
        });
  }, [element]);

  return nearness;
};
