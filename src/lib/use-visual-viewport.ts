import { useEffect } from "react";

type Viewport = Pick<
  VisualViewport,
  "addEventListener" | "height" | "offsetTop" | "removeEventListener"
>;

export const followViewport = (
  element: { style: Pick<CSSStyleDeclaration, "setProperty"> },
  viewport: Viewport
) => {
  const write = () => {
    element.style.setProperty(
      "--visual-viewport-height",
      `${viewport.height}px`
    );
    element.style.setProperty(
      "--visual-viewport-top",
      `${viewport.offsetTop}px`
    );
  };

  write();
  // oxlint-disable-next-line github/prefer-observers -- visualViewport reports keyboard resizes only through its resize event
  viewport.addEventListener("resize", write);
  // oxlint-disable-next-line github/prefer-observers -- visualViewport reports its offset only through its scroll event
  viewport.addEventListener("scroll", write);

  return () => {
    viewport.removeEventListener("resize", write);
    viewport.removeEventListener("scroll", write);
  };
};

export const useVisualViewport = (element: HTMLElement | null) => {
  useEffect(() => {
    const viewport = window.visualViewport;

    return element === null || viewport === null
      ? undefined
      : followViewport(element, viewport);
  }, [element]);
};
