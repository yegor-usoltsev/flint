import { expect, test } from "bun:test";

import { diagramsIn } from "~/lib/markdown-diagrams";
import {
  diagramConfig,
  diagramVars,
  dropGlobalRules,
  fitsColumn,
  scopeDiagram,
  smallestLabel,
} from "~/lib/mermaid";

const payload = "@keyframes enter { from { opacity: 0 } to { opacity: 0 } }";

test.each([
  `%%{init: {"themeCSS": "${payload}", "securityLevel": "loose", "fontFamily": "Comic Sans", "themeVariables": {"primaryColor": "red"}}}%%\ngraph TD\nA-->B`,
  `---\nconfig:\n  themeCSS: "${payload}"\n  securityLevel: loose\n  themeVariables:\n    primaryColor: red\n---\ngraph TD\nA-->B`,
])("diagram source cannot change theme or security config", async (source) => {
  const { default: mermaid } = await import("mermaid");

  mermaid.initialize(diagramConfig("light", "monospace"));
  await mermaid.parse(source);

  // oxlint-disable-next-line typescript/no-deprecated -- The resolved config with directives applied is only reachable through mermaidAPI.
  const config = mermaid.mermaidAPI.getConfig();

  expect(config.themeCSS).toBeUndefined();
  expect(config.securityLevel).toBe("strict");
  expect(config.themeVariables).toMatchObject({
    fontFamily: "monospace",
    primaryColor: "#f6f6f8",
  });
});

test("rendered styles lose global at-rules", () => {
  expect(
    dropGlobalRules(
      `#m .node{fill:red}${payload}@import url(x.css);@-webkit-keyframes a{0%{top:0}}@font-face{font-family:x}#m .edge{stroke:blue}`
    )
  ).toBe("#m .node{fill:red}#m .edge{stroke:blue}");

  expect(
    scopeDiagram(
      `<svg id="m"><style>#m p{margin:0}${payload}</style><g></g></svg>`
    )
  ).toBe('<svg id="m"><style>#m p{margin:0}</style><g></g></svg>');
});

test("diagram fences match backtick, tilde, longer, CRLF and nested fences", () => {
  expect(
    diagramsIn(
      "a\r\n```mermaid\r\ngraph TD\r\nA-->B\r\n```\r\n\n~~~mermaid\nflowchart LR\nX-->Y\n~~~\n\n````mermaid\nsequenceDiagram\n```\ninner\n```\n````\n\n```mermaid\npie\n`````\n\n```ts\nconst x = 1;\n```\n\n- item\n\n  ```mermaid\n  graph LR\n    L-->M\n  ```\n\n> ```mermaid\n> classDiagram\n> ```"
    )
  ).toEqual([
    "graph TD\nA-->B",
    "flowchart LR\nX-->Y",
    "sequenceDiagram\n```\ninner\n```",
    "pie",
    "graph LR\n  L-->M",
    "classDiagram",
  ]);
});

test("a diagram never shrinks its smallest label below 12 px", () => {
  const svg =
    '<svg><style>.label{font-size:13px}.edgeTerminals{font-size: 11px}</style><text font-size="10">1</text></svg>';

  expect(smallestLabel(svg)).toBe(10);
  expect(smallestLabel("<svg></svg>")).toBe(13);
  expect(
    smallestLabel("<svg><style>.c4-type{font-size: 0.75em}</style></svg>")
  ).toBe(9.75);
  expect(smallestLabel('<svg><g style="font-size: 75%"></g></svg>')).toBe(9.75);
  expect(smallestLabel('<svg><text font-size="0.1"></text></svg>')).toBe(6);
  expect(diagramVars({ height: 100, width: 1300 }).min).toBe("1200px");
  expect(diagramVars({ height: 100, width: 1300 }, 10).min).toBe("1560px");
});

test("a phone fits a diagram to the column unless its labels would fall below 45 %", () => {
  const architecture = { height: 300, width: 636 };

  expect(fitsColumn(architecture, 327)).toBe(true);
  expect(fitsColumn(architecture, 280)).toBe(false);
  expect(fitsColumn(architecture, 327, 9.75)).toBe(false);
  expect(fitsColumn({ height: 50, width: 200 }, 327, 6)).toBe(true);
});
