import { queryOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type { Mermaid, MermaidConfig } from "mermaid";
import { useSyncExternalStore } from "react";
// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

let loading: Promise<Mermaid> | null = null;
let theme: "dark" | "light" | undefined;
let renders = 0;
const labelPx = 13;
const minLabelPx = 12;

const palettes = {
  dark: {
    lineColor: "#8d919c",
    primaryBorderColor: "#4a4d57",
    primaryColor: "#1c1d21",
    primaryTextColor: "#e4e5e9",
  },
  light: {
    lineColor: "#6f737d",
    primaryBorderColor: "#c3c6ce",
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
    fontSize: `${labelPx}px`,
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

  let mermaid: Mermaid;

  try {
    mermaid = await loading;
  } catch (error) {
    loading = null;
    throw error;
  }

  if (theme !== wanted) {
    theme = wanted;
    mermaid.initialize(
      diagramConfig(
        wanted,
        getComputedStyle(document.documentElement).getPropertyValue(
          "--font-sans"
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

export interface DiagramSize {
  height: number;
  width: number;
}

const unitScale = new Map([
  ["%", labelPx / 100],
  ["em", labelPx],
]);

export const smallestLabel = (svg: string) => {
  let smallest = labelPx;

  for (const match of svg.matchAll(
    /font-size(?::\s*(?<css>[\d.]+)(?<unit>px|em|%)|="(?<attr>[\d.]+)")/gu
  )) {
    const value = Number(match.groups?.["css"] ?? match.groups?.["attr"]);
    const px = value * (unitScale.get(match.groups?.["unit"] ?? "px") ?? 1);

    if (px > 0 && px < smallest) {
      smallest = px;
    }
  }

  return Math.max(smallest, minLabelPx / 2);
};

export const diagramVars = (size: DiagramSize, smallest = labelPx) => ({
  min: `${(size.width * minLabelPx) / Math.min(smallest, labelPx)}px`,
  ratio: `${size.width} / ${size.height}`,
  width: `${size.width / 16}rem`,
});

const minFitScale = 0.45;

export const fitsColumn = (
  size: DiagramSize,
  available: number,
  smallest = labelPx
) =>
  (Math.min(1, available / size.width) * Math.min(smallest, labelPx)) /
    labelPx >=
  minFitScale;

const sizesKey = "flint:diagram-sizes";
const sizeLimit = 200;
const SizesSchema = v.record(v.string(), v.tuple([v.number(), v.number()]));

const hashCode = (code: string) => {
  let hash = 7;

  for (const char of code) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 2_147_483_647;
  }

  return `${code.length.toString(36)}.${hash.toString(36)}`;
};

const writeSizes = (value: string) => {
  try {
    localStorage.setItem(sizesKey, value);

    return true;
  } catch {
    return false;
  }
};

const readSizes = () => {
  try {
    const parsed = v.safeParse(
      SizesSchema,
      JSON.parse(localStorage.getItem(sizesKey) ?? "{}")
    );

    return parsed.success ? parsed.output : {};
  } catch {
    return {};
  }
};

export const svgSize = (svg: string): DiagramSize | undefined => {
  const box =
    /viewBox="[-\d.e]+[\s,]+[-\d.e]+[\s,]+(?<width>[\d.e]+)[\s,]+(?<height>[\d.e]+)"/u.exec(
      svg
    )?.groups;

  const boxWidth = Number(box?.["width"]);
  const boxHeight = Number(box?.["height"]);

  if (!(boxWidth > 0 && boxHeight > 0)) {
    return undefined;
  }

  const maxWidth = Number(
    /max-width:\s*(?<width>[\d.e]+)px/u.exec(svg)?.groups?.["width"]
  );

  const width = maxWidth > 0 ? maxWidth : boxWidth;

  return { height: (boxHeight * width) / boxWidth, width };
};

export const diagramSize = (code: string): DiagramSize | undefined => {
  const size = readSizes()[hashCode(code)];

  return size === undefined ? undefined : { height: size[1], width: size[0] };
};

const rememberSize = (code: string, svg: string) => {
  const size = svgSize(svg);

  if (size === undefined) {
    return;
  }

  const key = hashCode(code);
  const sizes = Object.entries(readSizes()).filter(([entry]) => entry !== key);
  const width = Math.round(size.width * 10) / 10;
  const height = Math.round(size.height * 10) / 10;

  writeSizes(
    JSON.stringify(
      Object.fromEntries([
        ...sizes.slice(-(sizeLimit - 1)),
        [key, [width, height]],
      ])
    )
  );
};

export const diagramQuery = (code: string, dark: boolean) =>
  queryOptions({
    queryFn: async () => {
      const svg = await renderDiagram(code, dark);

      rememberSize(code, svg);

      return svg;
    },
    queryKey: ["mermaid", "svg", code, dark],
    retry: false,
    staleTime: "static",
  });

const prefetchWait = 300;

export const prefetchDiagrams = async (
  queryClient: QueryClient,
  markdown: string
) => {
  if (!markdown.includes("mermaid")) {
    return;
  }

  const dark = document.documentElement.classList.contains("dark");
  const wait = Promise.withResolvers<null>();

  setTimeout(() => {
    wait.resolve(null);
  }, prefetchWait);

  const render = async () => {
    const { diagramsIn } = await import("~/lib/markdown-diagrams");

    const codes = diagramsIn(markdown).filter((code) => code.trim() !== "");

    await Promise.all(
      codes.map(
        async (code) =>
          await queryClient.query(diagramQuery(code, dark)).catch(() => null)
      )
    );
  };

  await Promise.race([render().catch(() => null), wait.promise]);
};

export const diagramImage = (
  svg: string,
  background: string | null,
  fill?: DiagramSize
) => {
  const root = new DOMParser()
    .parseFromString(svg, "text/html")
    .querySelector("svg");

  const size = svgSize(svg);

  if (root === null || size === undefined) {
    return null;
  }

  const scale =
    fill === undefined
      ? 1
      : Math.max(
          1,
          2 * Math.min(fill.width / size.width, fill.height / size.height)
        );

  root.setAttribute("width", String(size.width * scale));
  root.setAttribute("height", String(size.height * scale));
  root.style.removeProperty("max-width");

  if (background !== null) {
    root.style.setProperty("background-color", background);
  }

  return URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(root)], {
      type: "image/svg+xml",
    })
  );
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
