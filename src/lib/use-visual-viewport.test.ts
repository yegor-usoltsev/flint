import { expect, test } from "bun:test";

import { followViewport } from "~/lib/use-visual-viewport";

const sheet = () => {
  const style = new Map<string, string>();

  return {
    element: {
      style: {
        setProperty: (name: string, value: string) => {
          style.set(name, value);
        },
      },
    },
    style,
  };
};

test("each sheet follows the keyboard on its own element, after another sheet closes", () => {
  const viewport = Object.assign(new EventTarget(), {
    height: 800,
    offsetTop: 0,
  });

  const create = sheet();
  const palette = sheet();
  const releaseCreate = followViewport(create.element, viewport);
  const releasePalette = followViewport(palette.element, viewport);

  releasePalette();
  viewport.height = 400;
  viewport.offsetTop = 20;
  viewport.dispatchEvent(new Event("resize"));

  expect(create.style.get("--visual-viewport-height")).toBe("400px");
  expect(create.style.get("--visual-viewport-top")).toBe("20px");
  expect(palette.style.get("--visual-viewport-height")).toBe("800px");

  releaseCreate();
  viewport.height = 300;
  viewport.dispatchEvent(new Event("resize"));

  expect(create.style.get("--visual-viewport-height")).toBe("400px");
});
