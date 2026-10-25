import { cn } from "cn";
import { lazy, Suspense } from "react";

import type { MarkdownEditorProps } from "~/components/markdown-editor";

const Editor = lazy(async () => {
  const { MarkdownEditor } = await import("~/components/markdown-editor");

  return { default: MarkdownEditor };
});

// Tiptap, ProseMirror and lowlight load with the first editor, so screens without one stay light.
export const LazyMarkdownEditor = (props: MarkdownEditorProps) => (
  <Suspense
    fallback={
      <div className={cn("text-muted-foreground", props.className)}>
        {props.value === "" ? props.placeholder : props.value}
      </div>
    }
  >
    <Editor {...props} />
  </Suspense>
);
