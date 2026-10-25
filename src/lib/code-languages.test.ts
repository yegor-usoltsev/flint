import { expect, test } from "bun:test";

import { detectLanguage, lowlight } from "~/lib/code-languages";

const typescript =
  "export const add = async (a: number, b: number): Promise<number> => {\n  const result = await Promise.resolve(a + b);\n  return result;\n};\n";

test("auto detection recognizes common languages", () => {
  expect(detectLanguage(typescript)).toBe("TypeScript");
  expect(
    detectLanguage('def add(a, b):\n    """Sum."""\n    return a + b\n')
  ).toBe("Python");
  expect(detectLanguage('{"a": 1, "b": [true, null]}')).toBe("JSON");
});

test("auto highlighting stays fast on large blocks", () => {
  const large = typescript.repeat(250);
  const start = performance.now();

  for (const suffix of ["a", "b", "c", "d", "e"]) {
    lowlight.highlightAuto(large.slice(0, 15_000) + suffix);
    detectLanguage(large.slice(0, 15_000) + suffix);
  }

  expect(performance.now() - start).toBeLessThan(250);
  expect(lowlight.highlightAuto(large).data?.language).toBe("plaintext");
  expect(detectLanguage(large)).toBe("Plaintext");
});
