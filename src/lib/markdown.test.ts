import { describe, expect, test } from "bun:test";

import type { JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";

import { markdownExtensions } from "~/lib/markdown";

const manager = new MarkdownManager({ extensions: markdownExtensions() });

const roundTrip = (markdown: string) =>
  manager.serialize(manager.parse(markdown));

const issue = `## Context

Reported by a teammate while working on release 3. See ENG-12 and [the spec](https://example.com/spec).

Steps to reproduce:

1. Open the project board.
2. Drag a card across columns.
3. Reload the page.

## Checklist

- [x] Reproduce locally
- [ ] Fix the bug
  - [ ] Nested step
- [ ] Ship it

\`\`\`ts
const answer = await api(\`/issues/ENG-1\`);
\`\`\`

The \`sort_key\` column compares bytes, so 2 < 3 & a > b holds for snake_case_names.`;

const media = `Before the media.

![Diagram](/files/0193a1b2-0000-7000-8000-000000000000)

<img src="/files/0193a1b2-0000-7000-8000-000000000001" alt="Screenshot" width="320">

<video src="/files/0193a1b2-0000-7000-8000-000000000002" controls width="480"></video>

<video src="https://example.com/clip.webm" controls></video>

<audio src="/files/0193a1b2-0000-7000-8000-000000000003" controls></audio>

After the media.`;

const wiki = `# Deploy guide

Production runs on **one** server with *Postgres* and ~~Meilisearch~~ S3.

> Keep the token out of the repository.

- Install Bun
- Copy \`.env.example\`
  - Set \`APP_URL\`

| Variable | Default |
| --- | --- |
| \`PORT\` | 4700 |

![Diagram](/files/0193a1b2-0000-7000-8000-000000000000)

---

Line one
line two`;

describe("markdown round trip", () => {
  test.each([
    ["issue", issue],
    ["wiki", wiki],
    ["media", media],
  ])("keeps a typical %s document stable", (_name, markdown) => {
    const once = roundTrip(markdown);

    expect(roundTrip(once)).toBe(once);
  });

  test("keeps an issue description unchanged", () => {
    expect(roundTrip(issue)).toBe(issue);
  });

  test("keeps raw HTML as literal text", () => {
    const once = roundTrip("Before <script>alert(1)</script> after");

    expect(once).toBe(String.raw`Before \<script>alert(1)\</script> after`);
    expect(manager.parse(once).content?.[0]?.content).toEqual([
      { text: "Before <script>alert(1)</script> after", type: "text" },
    ]);
  });

  test("escapes only text that would turn into markup", () => {
    expect(roundTrip(String.raw`a \*b\* and \_c\_ and \&amp; d`)).toBe(
      String.raw`a \*b\* and \_c\_ and \&amp; d`
    );
  });

  test.each([
    String.raw`\# not a heading`,
    String.raw`\- not a list`,
    String.raw`\+ not a list`,
    String.raw`1\. not a list`,
    String.raw`2\) not a list`,
    String.raw`\---`,
    String.raw`\> not a quote`,
    "first line\\\n\\# second line",
    "first line\n\\===",
    "first line\n\\# second line",
  ])("keeps %j a literal paragraph", (markdown) => {
    const literal = manager.parse(markdown).content;

    expect(literal?.map((node) => node.type)).toEqual(["paragraph"]);
    expect(manager.parse(roundTrip(markdown)).content).toEqual(literal);
  });

  test("leaves block markers inside a line alone", () => {
    expect(roundTrip("Item 1. costs - nothing # really")).toBe(
      "Item 1. costs - nothing # really"
    );
  });
});

const blocks = `Code:

\`\`\`python
def answer():
    return 42
\`\`\`

\`\`\`
no language
\`\`\`

\`\`\`mermaid
graph LR
  A[Todo] --> B[In Progress] --> C[Done]
\`\`\`

| Name | Value |
| ---- | ----- |
| a    | 1     |
|      |       |

Done.`;

describe("editor blocks", () => {
  test("keeps code fences, diagrams and tables unchanged", () => {
    expect(roundTrip(blocks)).toBe(blocks);
  });

  test("stores the language in the fence info string", () => {
    const [code] = manager.parse("```ts\nconst a = 1;\n```").content ?? [];

    expect(code).toMatchObject({
      attrs: { language: "ts" },
      type: "codeBlock",
    });
    expect(
      manager.serialize({
        content: [
          {
            attrs: { language: "mermaid" },
            content: [{ text: "graph TD\n  A --> B", type: "text" }],
            type: "codeBlock",
          },
        ],
        type: "doc",
      })
    ).toBe("```mermaid\ngraph TD\n  A --> B\n```");
  });
  test.each([
    "````markdown\nUse a fence:\n\n```ts\nconst a = 1;\n```\n````",
    "```\nInline ``code`` and ~~~ tildes\n```",
    "~~~a`b\ncode with ``` inside\n~~~",
  ])("keeps a code block that holds fences intact: %#", (markdown) => {
    const [code, ...rest] = manager.parse(markdown).content ?? [];

    expect(rest).toEqual([]);
    expect(code?.type).toBe("codeBlock");
    expect(roundTrip(markdown)).toBe(markdown);
    expect(roundTrip(roundTrip(markdown))).toBe(markdown);
  });

  const cellBreaks = `| Step | Notes |
| ---- | ----- |
| Deploy | First line<br>Second line |
| Check<br>twice | <b>bold</b> and <BR/> |`;

  test("keeps line breaks in table cells as breaks", () => {
    const once = roundTrip(cellBreaks);
    const [table] = manager.parse(cellBreaks).content ?? [];

    expect(table?.content?.[1]?.content?.[1]?.content?.[0]?.content).toEqual([
      { text: "First line", type: "text" },
      { type: "hardBreak" },
      { text: "Second line", type: "text" },
    ]);
    expect(once).toContain("| First line<br>Second line |");
    expect(once).toContain(String.raw`\<b>bold\</b> and<br>`);
    expect(roundTrip(once)).toBe(once);
  });

  test("keeps <br> outside table cells as literal text", () => {
    const once = roundTrip("First line<br>Second line");

    expect(manager.parse(once).content?.[0]?.content).toEqual([
      { text: "First line<br>Second line", type: "text" },
    ]);
    expect(roundTrip(once)).toBe(once);
  });
});

describe("media HTML", () => {
  test("keeps a document with media unchanged", () => {
    expect(roundTrip(media)).toBe(media);
  });

  test.each([
    [
      `<img width=200 alt='A "quoted" <b>' src="/files/a?x=1&amp;y=2" style="x">`,
      `<img src="/files/a?x=1&amp;y=2" alt="A &quot;quoted&quot; &lt;b&gt;" width="200">`,
    ],
    [
      `<img src="/files/a" width="200"/>`,
      `<img src="/files/a" alt="" width="200">`,
    ],
    [`<IMG SRC="https://example.com/a.png">`, "![](https://example.com/a.png)"],
    [`<img src="/files/a" width="0">`, "![](/files/a)"],
    [`<img src="/files/a" alt="a]b">`, String.raw`![a\]b](/files/a)`],
    [String.raw`<img src="/files/a" alt="end\">`, "![end](/files/a)"],
    [`<img src="/files/a b(1).png" alt="">`, "![](/files/a%20b%281%29.png)"],
    ["![a](</files/a b>)", "![a](/files/a%20b)"],
    [
      String.raw`![a](/files/a "say \"hi\"")`,
      String.raw`![a](/files/a "say \"hi\"")`,
    ],
    [`<img src="/files/a" width="100000">`, "![](/files/a)"],
    [`<img src="/files/a" width="50%">`, "![](/files/a)"],
    [
      `<video src="/files/v" autoplay loop width="480" height="270"></video>`,
      `<video src="/files/v" controls width="480"></video>`,
    ],
    [
      `<video src="/files/v"></video>`,
      `<video src="/files/v" controls></video>`,
    ],
    [
      `<audio src="/files/a" width="300" autoplay></audio>`,
      `<audio src="/files/a" controls></audio>`,
    ],
  ])("normalizes %j", (markdown, expected) => {
    expect(roundTrip(markdown)).toBe(expected);
    expect(roundTrip(expected)).toBe(expected);
  });

  test("parses only allowlisted attributes", () => {
    expect(
      manager.parse(`<img src="/files/a" alt="A" width="200" onerror="x()">`)
        .content
    ).toEqual([
      { attrs: { alt: "A", src: "/files/a", width: 200 }, type: "image" },
    ]);
    expect(manager.parse(`<video src="/files/v" width="9">`).content).toEqual([
      { attrs: { src: "/files/v", width: 9 }, type: "video" },
    ]);
  });

  test("keeps a media line inside a list item", () => {
    const markdown = `- <img src="/files/a" alt="" width="100">`;

    expect(roundTrip(markdown)).toBe(markdown);
  });

  test.each([
    `<img src="javascript:alert(1)">`,
    `<img src="data:image/png;base64,AAAA">`,
    `<img src="//evil.example/a.png">`,
    `<video src="vbscript:x" controls></video>`,
    `<img src=" javascript:alert(1)">`,
    `<img src="/files/a" alt="x" onerror="alert(1)" <b>`,
    `<iframe src="/files/a"></iframe>`,
    `<script src="/files/a"></script>`,
    `<object data="/files/a"></object>`,
    `Inline <img src="/files/a" width="10"> image`,
    "![x](javascript:window.__pwned=1)",
    "![x](JavaScript:alert(1))",
    "![x](data:image/png;base64,AAAA)",
    "![x](vbscript:x)",
    "![x](//evil.example/a.png)",
    "Text ![x](javascript:x) more",
    String.raw`![x](/\evil.test/a.png)`,
    String.raw`<img src="/\evil.test/a.png">`,
    `<img src="/\t/evil.test/a.png">`,
    `<img src="/files/a\u0000">`,
  ])("keeps %j inert", (markdown) => {
    const types = new Set<string>();

    const collect = (nodes: JSONContent[] = []) => {
      for (const node of nodes) {
        types.add(node.type ?? "");
        collect(node.content);
      }
    };

    collect(manager.parse(markdown).content);

    expect([...types].filter((type) => type !== "text")).toEqual(["paragraph"]);
    expect(roundTrip(roundTrip(markdown))).toBe(roundTrip(markdown));
  });
});
