import type { MarkdownEditor } from "~/components/markdown-editor";

let loaded: typeof MarkdownEditor | null = null;

export const loadEditor = async () => {
  const module = await import("~/components/markdown-editor");

  loaded = module.MarkdownEditor;

  return { default: module.MarkdownEditor };
};

export const loadedEditor = () => loaded;
