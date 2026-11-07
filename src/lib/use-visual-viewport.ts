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

export const holdViewport = () => {
  const viewport = window.visualViewport;

  users += 1;
  writeViewport();

  if (users === 1) {
    // oxlint-disable-next-line github/prefer-observers -- visualViewport reports keyboard resizes only through its resize event
    viewport?.addEventListener("resize", writeViewport);
    // oxlint-disable-next-line github/prefer-observers -- visualViewport reports its offset only through its scroll event
    viewport?.addEventListener("scroll", writeViewport);
  }

  return () => {
    users -= 1;

    if (users === 0) {
      viewport?.removeEventListener("resize", writeViewport);
      viewport?.removeEventListener("scroll", writeViewport);
      clearViewport();
    }
  };
};

export const useVisualViewport = (active: boolean) => {
  useEffect(() => (active ? holdViewport() : undefined), [active]);
};
