import { afterEach, expect, test } from "bun:test";

import { holdViewport } from "~/lib/use-visual-viewport";

const descriptors = new Map<string, PropertyDescriptor | undefined>();

interface StyleStub {
  removeProperty: (name: string) => void;
  setProperty: (name: string, value: string) => void;
}

type BrowserStub =
  | { documentElement: { style: StyleStub } }
  | { visualViewport: EventTarget };

const replace = (name: string, value: BrowserStub) => {
  if (!descriptors.has(name)) {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  }

  Object.defineProperty(globalThis, name, { configurable: true, value });
};

afterEach(() => {
  for (const [name, descriptor] of descriptors) {
    if (descriptor === undefined) {
      Reflect.deleteProperty(globalThis, name);
    } else {
      Object.defineProperty(globalThis, name, descriptor);
    }
  }

  descriptors.clear();
});

const stubViewport = () => {
  const viewport = Object.assign(new EventTarget(), {
    height: 800,
    offsetTop: 0,
  });

  const style = new Map<string, string>();

  replace("window", { visualViewport: viewport });
  replace("document", {
    documentElement: {
      style: {
        removeProperty: (name: string) => {
          style.delete(name);
        },
        setProperty: (name: string, value: string) => {
          style.set(name, value);
        },
      },
    },
  });

  return { style, viewport };
};

test("a sheet keeps following the keyboard after another sheet over it closes", () => {
  const { style, viewport } = stubViewport();
  const releaseCreate = holdViewport();
  const releasePalette = holdViewport();

  releasePalette();
  viewport.height = 400;
  viewport.dispatchEvent(new Event("resize"));

  expect(style.get("--visual-viewport-height")).toBe("400px");

  releaseCreate();

  expect(style.has("--visual-viewport-height")).toBe(false);
});
