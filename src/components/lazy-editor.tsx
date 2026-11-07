import { cn } from "cn";
import { lazy, Suspense } from "react";

import type { MarkdownEditorProps } from "~/components/markdown-editor";
import { MarkdownView } from "~/components/markdown-view";

const Editor = lazy(async () => {
  const { MarkdownEditor } = await import("~/components/markdown-editor");

  return { default: MarkdownEditor };
});

export const LazyMarkdownEditor = (props: MarkdownEditorProps) => {
  const {
    attachments,
    className,
    editable = true,
    placeholder,
    uploadTo,
  } = props;

  return (
    <Suspense
      fallback={
        <MarkdownView
          attachments={
            attachments === null ? undefined : (attachments ?? uploadTo)
          }
          className={className}
          editable={editable}
          placeholder={editable ? placeholder : undefined}
          value={props.value}
        />
      }
    >
      <Editor {...props} />
    </Suspense>
  );
};

export const SourceToggle = ({
  className,
  onChange,
  source,
}: {
  className?: string;
  onChange: (source: boolean) => void;
  source: boolean;
}) => (
  <button
    className={cn(
      "text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:ring-ring hit-area relative flex h-6 items-center gap-1 rounded-md px-1.5 text-xs outline-none focus-visible:ring-2",
      className
    )}
    onClick={() => {
      onChange(!source);
    }}
    type="button"
  >
    {source ? "Rich text" : "Markdown"}
  </button>
);
