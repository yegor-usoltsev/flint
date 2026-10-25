import type { Mermaid, MermaidConfig } from "mermaid";
import { useSyncExternalStore } from "react";

let loading: Promise<Mermaid> | undefined;
let theme: "dark" | "light" | undefined;
let renders = 0;

const palettes = {
  dark: {
    lineColor: "#6b6f7a",
    primaryBorderColor: "#34363d",
    primaryColor: "#1c1d21",
    primaryTextColor: "#e4e5e9",
  },
  light: {
    lineColor: "#9a9da6",
    primaryBorderColor: "#d8dae0",
    primaryColor: "#f6f6f8",
    primaryTextColor: "#1c1d21",
  },
};

// Diagram source may carry `%%{init}%%` or front matter config; only layout options stay open, because theme CSS lands in the inlined SVG.
const secure = [
  "secure",
  "securityLevel",
  "startOnLoad",
  "maxTextSize",
  "maxEdges",
  "suppressErrorRendering",
  "dompurifyConfig",
  "theme",
  "themeCSS",
  "themeVariables",
  "darkMode",
  "fontFamily",
  "altFontFamily",
  "fontSize",
  "look",
];

export const diagramConfig = (
  wanted: "dark" | "light",
  fontFamily: string
): MermaidConfig => ({
  look: "classic",
  secure,
  securityLevel: "strict",
  startOnLoad: false,
  suppressErrorRendering: true,
  theme: "base",
  themeVariables: {
    ...palettes[wanted],
    background: "transparent",
    fontFamily,
    fontSize: "13px",
  },
});

const globalAtRule = /@(?:-\w+-)?(?:font-face|import|keyframes)\b/giu;

const atRuleEnd = (css: string, start: number) => {
  let depth = 0;

  for (let index = start; index < css.length; index += 1) {
    const char = css[index];

    if (char === ";" && depth === 0) {
      return index + 1;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;

      if (depth <= 0) {
        return index + 1;
      }
    }
  }

  return css.length;
};

// Keyframe and font names are global in an inlined SVG, so a diagram could restyle the app's own animations.
export const dropGlobalRules = (css: string) => {
  let kept = "";
  let from = 0;

  for (const match of css.matchAll(globalAtRule)) {
    if (match.index >= from) {
      kept += css.slice(from, match.index);
      from = atRuleEnd(css, match.index);
    }
  }

  return kept + css.slice(from);
};

export const scopeDiagram = (svg: string) =>
  svg.replaceAll(/<style\b[^>]*>[\s\S]*?<\/style>/gu, (block) => {
    const start = block.indexOf(">") + 1;
    const end = block.lastIndexOf("<");

    return (
      block.slice(0, start) +
      dropGlobalRules(block.slice(start, end)) +
      block.slice(end)
    );
  });

const load = async (wanted: "dark" | "light") => {
  loading ??= import("mermaid").then(({ default: mermaid }) => mermaid);

  const mermaid = await loading;

  if (theme !== wanted) {
    theme = wanted;
    mermaid.initialize(
      diagramConfig(
        wanted,
        getComputedStyle(document.documentElement).getPropertyValue(
          "--font-mono"
        )
      )
    );
  }

  return mermaid;
};

export const parseDiagram = async (code: string) => {
  const mermaid = await load(theme ?? "light");

  await mermaid.parse(code);

  return true;
};

export const renderDiagram = async (code: string, dark: boolean) => {
  const mermaid = await load(dark ? "dark" : "light");

  renders += 1;

  const { svg } = await mermaid.render(`mermaid-${renders}`, code);

  return scopeDiagram(svg);
};

const subscribe = (onChange: () => void) => {
  const observer = new MutationObserver(onChange);

  observer.observe(document.documentElement, { attributeFilter: ["class"] });

  return () => {
    observer.disconnect();
  };
};

export const useDarkTheme = () =>
  useSyncExternalStore(
    subscribe,
    () => document.documentElement.classList.contains("dark"),
    () => false
  );
