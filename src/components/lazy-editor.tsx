import { cn } from "cn";
import { lazy, Suspense, useImperativeHandle, useRef, useState } from "react";
import type { ReactNode } from "react";

import { loadedEditor, loadEditor } from "~/components/editor-chunk";
import type {
  MarkdownEditorHandle,
  MarkdownEditorProps,
} from "~/components/markdown-editor";

const Editor = lazy(loadEditor);

type Call = (handle: MarkdownEditorHandle) => void;

// Tiptap, ProseMirror and lowlight load with the first editor, so screens without one stay light.
export const LazyMarkdownEditor = ({
  fallback,
  ref,
  ...props
}: MarkdownEditorProps & { fallback?: ReactNode }) => {
  const editor = useRef<MarkdownEditorHandle | null>(null);
  const pending = useRef<Call[]>([]);
  // oxlint-disable-next-line react/hook-use-state -- The editor is picked once per mount, so a module that loads later never swaps the tree.
  const [Ready] = useState(loadedEditor);

  const run = (call: Call) => {
    if (editor.current === null) {
      pending.current.push(call);
    } else {
      call(editor.current);
    }
  };

  useImperativeHandle(ref, () => ({
    focus: () => {
      run((handle) => {
        handle.focus();
      });
    },
    upload: (files) => {
      run((handle) => {
        handle.upload(files);
      });
    },
  }));

  const attach = (handle: MarkdownEditorHandle | null) => {
    editor.current = handle;

    if (handle !== null) {
      for (const call of pending.current.splice(0)) {
        call(handle);
      }
    }
  };

  if (Ready !== null) {
    return <Ready {...props} ref={attach} />;
  }

  return (
    <Suspense
      fallback={
        fallback ?? (
          <div className={cn("text-muted-foreground", props.className)}>
            {props.value === "" ? props.placeholder : props.value}
          </div>
        )
      }
    >
      <Editor {...props} ref={attach} />
    </Suspense>
  );
};
