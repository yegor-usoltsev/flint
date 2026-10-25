import { expect, test } from "bun:test";

import { diagramConfig, dropGlobalRules, scopeDiagram } from "~/lib/mermaid";

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
