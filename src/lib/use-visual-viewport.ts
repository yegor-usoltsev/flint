import { useEffect } from "react";

let users = 0;

const writeViewport = () => {
  const viewport = window.visualViewport;

  if (viewport === null) {
    return;
  }

  const root = document.documentElement.style;

  root.setProperty("--visual-viewport-height", `${viewport.height}px`);
  root.setProperty("--visual-viewport-top", `${viewport.offsetTop}px`);
};

const clearViewport = () => {
  document.documentElement.style.removeProperty("--visual-viewport-height");
  document.documentElement.style.removeProperty("--visual-viewport-top");
};

export const useVisualViewport = (active: boolean) => {
  useEffect(() => {
    const viewport = active ? window.visualViewport : null;

    if (viewport !== null) {
      users += 1;
      writeViewport();
      // oxlint-disable-next-line github/prefer-observers -- visualViewport reports keyboard resizes only through its resize event
      viewport.addEventListener("resize", writeViewport);
      // oxlint-disable-next-line github/prefer-observers -- visualViewport reports its offset only through its scroll event
      viewport.addEventListener("scroll", writeViewport);
    }

    return () => {
      viewport?.removeEventListener("resize", writeViewport);
      viewport?.removeEventListener("scroll", writeViewport);
      users -= viewport === null ? 0 : 1;

      if (viewport !== null && users === 0) {
        clearViewport();
      }
    };
  }, [active]);
};
