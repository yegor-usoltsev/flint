import type { LanguageFn } from "highlight.js";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import clojure from "highlight.js/lib/languages/clojure";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import dart from "highlight.js/lib/languages/dart";
import diff from "highlight.js/lib/languages/diff";
import elixir from "highlight.js/lib/languages/elixir";
import excel from "highlight.js/lib/languages/excel";
import go from "highlight.js/lib/languages/go";
import graphql from "highlight.js/lib/languages/graphql";
import haskell from "highlight.js/lib/languages/haskell";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import ocaml from "highlight.js/lib/languages/ocaml";
import perl from "highlight.js/lib/languages/perl";
import php from "highlight.js/lib/languages/php";
import plaintext from "highlight.js/lib/languages/plaintext";
import protobuf from "highlight.js/lib/languages/protobuf";
import python from "highlight.js/lib/languages/python";
import r from "highlight.js/lib/languages/r";
import reasonml from "highlight.js/lib/languages/reasonml";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import verilog from "highlight.js/lib/languages/verilog";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { createLowlight } from "lowlight";

interface CodeLanguage {
  grammar?: LanguageFn;
  id: string;
  label: string;
}

// The picker order; the id is the fence info string. Cypher, ReScript and Terraform have no highlight.js grammar and stay plain.
export const codeLanguages: CodeLanguage[] = [
  { grammar: bash, id: "bash", label: "Bash" },
  { grammar: csharp, id: "csharp", label: "C#" },
  { grammar: cpp, id: "cpp", label: "C++" },
  { grammar: css, id: "css", label: "CSS" },
  { grammar: clojure, id: "clojure", label: "Clojure" },
  { id: "cypher", label: "Cypher" },
  { grammar: dart, id: "dart", label: "Dart" },
  { grammar: diff, id: "diff", label: "Diff" },
  { grammar: elixir, id: "elixir", label: "Elixir" },
  { grammar: excel, id: "excel", label: "Excel" },
  { grammar: go, id: "go", label: "Golang" },
  { grammar: graphql, id: "graphql", label: "GraphQL" },
  { id: "html", label: "HTML" },
  { grammar: haskell, id: "haskell", label: "Haskell" },
  { grammar: json, id: "json", label: "JSON" },
  { grammar: java, id: "java", label: "Java" },
  { grammar: javascript, id: "javascript", label: "JavaScript" },
  { grammar: kotlin, id: "kotlin", label: "Kotlin" },
  { grammar: makefile, id: "makefile", label: "Makefile" },
  { grammar: markdown, id: "markdown", label: "Markdown" },
  { grammar: ocaml, id: "ocaml", label: "OCaml" },
  { grammar: php, id: "php", label: "PHP" },
  { grammar: perl, id: "perl", label: "Perl" },
  { grammar: plaintext, id: "plaintext", label: "Plaintext" },
  { grammar: protobuf, id: "protobuf", label: "Protocol Buffers" },
  { grammar: python, id: "python", label: "Python" },
  { grammar: r, id: "r", label: "R" },
  { id: "rescript", label: "ReScript" },
  { grammar: reasonml, id: "reasonml", label: "ReasonML" },
  { grammar: ruby, id: "ruby", label: "Ruby" },
  { grammar: rust, id: "rust", label: "Rust" },
  { grammar: sql, id: "sql", label: "SQL" },
  { grammar: swift, id: "swift", label: "Swift" },
  { grammar: verilog, id: "verilog", label: "SystemVerilog" },
  { id: "toml", label: "TOML" },
  { id: "terraform", label: "Terraform" },
  { grammar: typescript, id: "typescript", label: "TypeScript" },
  { grammar: xml, id: "xml", label: "XML" },
  { grammar: yaml, id: "yaml", label: "YAML" },
];

const grammars = Object.fromEntries(
  codeLanguages.flatMap(({ grammar, id }) =>
    grammar === undefined ? [] : [[id, grammar]]
  )
);

const base = createLowlight({ ...grammars, ini });

base.registerAlias({
  plaintext: ["cypher", "rescript", "terraform", "mermaid", "text", "txt"],
});

type Root = ReturnType<typeof base.highlight>;

const remember = <Value>(
  cache: Map<string, Value>,
  key: string,
  compute: () => Value
) => {
  const hit = cache.get(key);

  if (hit !== undefined) {
    return hit;
  }

  const value = compute();

  cache.set(key, value);

  if (cache.size > 100) {
    cache.delete(cache.keys().next().value ?? key);
  }

  return value;
};

const highlighted = new Map<string, Root>();
const detected = new Map<string, string>();

// Auto detection runs every grammar over the text, so it samples the start of the block against common languages and leaves long blocks plain.
const autoSubset = [
  "bash",
  "cpp",
  "csharp",
  "css",
  "diff",
  "go",
  "java",
  "javascript",
  "json",
  "kotlin",
  "markdown",
  "php",
  "python",
  "ruby",
  "rust",
  "sql",
  "swift",
  "typescript",
  "xml",
  "yaml",
];

const sampleSize = 2000;
const autoLimit = 20_000;

export const detectLanguageId = (code: string) => {
  const sample = code.slice(0, sampleSize);

  return remember(
    detected,
    sample,
    () =>
      base.highlightAuto(sample, { subset: autoSubset }).data?.language ??
      "plaintext"
  );
};

const highlight = (language: string, code: string) =>
  remember(highlighted, `${language}\n${code}`, () =>
    base.highlight(language, code)
  );

// Tiptap re-highlights every code block on each keystroke inside one, so results are cached by text.
export const lowlight: typeof base = {
  ...base,
  highlight,
  highlightAuto: (code) =>
    highlight(
      code.length > autoLimit ? "plaintext" : detectLanguageId(code),
      code
    ),
};

const aliases = new Map(
  Object.entries({ ...grammars, ini }).flatMap(([id, grammar]) =>
    (grammar(hljs).aliases ?? []).map((alias) => [alias, id] as const)
  )
);

const labels = new Map(codeLanguages.map(({ id, label }) => [id, label]));

export const languageId = (language: string) => {
  const id = language.toLowerCase();

  return labels.has(id) ? id : (aliases.get(id) ?? id);
};

export const languageLabel = (language: string) =>
  labels.get(languageId(language)) ?? language;

export const detectLanguage = (code: string) =>
  languageLabel(code.length > autoLimit ? "plaintext" : detectLanguageId(code));
