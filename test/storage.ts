import { afterAll, beforeAll, beforeEach } from "bun:test";

export const memoryStorage = () => {
  const items = new Map<string, string>();

  beforeAll(() => {
    globalThis.localStorage = {
      clear: () => {
        items.clear();
      },
      getItem: (name) => items.get(name) ?? null,
      key: (index) => [...items.keys()][index] ?? null,
      get length() {
        return items.size;
      },
      removeItem: (name) => {
        items.delete(name);
      },
      setItem: (name, value) => {
        items.set(name, value);
      },
    };
  });

  beforeEach(() => {
    items.clear();
  });

  afterAll(() => {
    Reflect.deleteProperty(globalThis, "localStorage");
  });

  return items;
};
