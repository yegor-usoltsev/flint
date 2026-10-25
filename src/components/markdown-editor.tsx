import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Extension, InputRule } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { Placeholder } from "@tiptap/extensions";
import { CellSelection } from "@tiptap/pm/tables";
import {
  EditorContent,
  ReactNodeViewRenderer,
  useEditor,
  useEditorState,
} from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { cn } from "cn";
import {
  BoldIcon,
  CodeIcon,
  ItalicIcon,
  LinkIcon,
  PaperclipIcon,
  StrikethroughIcon,
} from "lucide-react";
import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type {
  ComponentProps,
  MouseEvent,
  ReactNode,
  Ref,
  RefObject,
  SyntheticEvent,
} from "react";

import { codeBlockView as CodeBlockView } from "~/components/code-block-view";
import {
  createUploadTarget,
  endOf,
  uploadInto,
  uploadIntoText,
  Uploads,
} from "~/components/editor-uploads";
import type {
  DraftRef,
  UploadState,
  UploadTarget,
  Uploader,
} from "~/components/editor-uploads";
import { MediaViewer } from "~/components/media-viewer";
import type { ViewerItem } from "~/components/media-viewer";
import { issueChipView, pageChipView } from "~/components/mention-chip";
import { useMentionMenu } from "~/components/mention-menu";
import { BlockKeys, useSlashMenu } from "~/components/slash-menu";
import { TableKeys, useTableMenu } from "~/components/table-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { api } from "~/lib/api";
import type { Attachment } from "~/lib/api-types";
import { isSafeUrl, markdownExtensions } from "~/lib/markdown";
import {
  createChangeGate,
  normalizeMarkdown,
  withoutTrailingLines,
  replaceMarkdown,
} from "~/lib/markdown-changes";
import {
  IssueMention,
  issueKeyPattern,
  Mentions,
  mentionsKey,
  PageMention,
} from "~/lib/markdown-mentions";
import { projectsQuery } from "~/lib/queries";
import { mediaKind, uploadFile } from "~/lib/uploads";
import { useWorkspace } from "~/lib/use-workspace";

const TaskShortcut = Extension.create({
  addInputRules: () => [
    new InputRule({
      find: /^\[(?<mark>[ xX]?)\]\s$/u,
      handler: ({ chain, match, range, state }) => {
        if (state.selection.$from.node(-1).type.name === "listItem") {
          chain()
            .deleteRange(range)
            .toggleTaskList()
            .updateAttributes("taskItem", {
              checked: /x/iu.test(match.groups?.["mark"] ?? ""),
            })
            .run();
        }
      },
    }),
  ],
  name: "taskShortcut",
});

const BubbleButton = ({
  active,
  children,
  label,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  label: string;
  onClick: () => void;
}) => (
  <button
    aria-label={label}
    aria-pressed={active}
    className="text-muted-foreground hover:bg-accent hover:text-foreground aria-pressed:text-foreground aria-pressed:bg-accent focus-visible:ring-ring flex size-7 items-center justify-center rounded-md outline-none focus-visible:ring-2 [&_svg]:size-3.5"
    onClick={onClick}
    onMouseDown={(event) => {
      event.preventDefault();
    }}
    type="button"
  >
    {children}
  </button>
);

const Bubble = ({ editor }: { editor: Editor }) => {
  const [linking, setLinking] = useState<string | null>(null);

  const marks = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive("bold"),
      code: current.isActive("code"),
      italic: current.isActive("italic"),
      link: current.isActive("link"),
      strike: current.isActive("strike"),
    }),
  });

  const chain = () => editor.chain().focus();

  return (
    <BubbleMenu
      className="bg-popover ring-foreground/10 flex items-center gap-0.5 rounded-lg p-1 shadow-md ring-1"
      editor={editor}
      options={{
        onHide: () => {
          setLinking(null);
        },
        placement: "top",
      }}
      shouldShow={({ editor: current, from, state, to }) =>
        current.isEditable &&
        from !== to &&
        !current.isActive("codeBlock") &&
        !(state.selection instanceof CellSelection)
      }
    >
      {linking === null ? (
        <>
          <BubbleButton
            active={marks.bold}
            label="Bold"
            onClick={() => {
              chain().toggleBold().run();
            }}
          >
            <BoldIcon />
          </BubbleButton>
          <BubbleButton
            active={marks.italic}
            label="Italic"
            onClick={() => {
              chain().toggleItalic().run();
            }}
          >
            <ItalicIcon />
          </BubbleButton>
          <BubbleButton
            active={marks.strike}
            label="Strikethrough"
            onClick={() => {
              chain().toggleStrike().run();
            }}
          >
            <StrikethroughIcon />
          </BubbleButton>
          <BubbleButton
            active={marks.code}
            label="Code"
            onClick={() => {
              chain().toggleCode().run();
            }}
          >
            <CodeIcon />
          </BubbleButton>
          <BubbleButton
            active={marks.link}
            label="Link"
            onClick={() => {
              setLinking(String(editor.getAttributes("link")["href"] ?? ""));
            }}
          >
            <LinkIcon />
          </BubbleButton>
        </>
      ) : (
        <input
          aria-label="Link URL"
          autoFocus
          className="h-7 w-64 bg-transparent px-2 outline-none"
          onChange={(event) => {
            setLinking(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) {
              return;
            }

            if (event.key === "Enter") {
              event.preventDefault();

              const href = linking.trim();

              if (href === "") {
                chain().extendMarkRange("link").unsetLink().run();
              } else if (isSafeUrl(href) || !href.includes(":")) {
                chain()
                  .extendMarkRange("link")
                  .setLink({
                    href: /^[\w.-]+\.\w{2,}/u.test(href)
                      ? `https://${href}`
                      : href,
                  })
                  .run();
              }

              setLinking(null);
            } else if (event.key === "Escape") {
              event.preventDefault();
              setLinking(null);
              editor.commands.focus();
            }
          }}
          placeholder="Paste a link and press Enter"
          value={linking}
        />
      )}
    </BubbleMenu>
  );
};

const codeBlockView = ReactNodeViewRenderer(CodeBlockView);

const normalized = (editor: Editor, markdown: string) =>
  editor.markdown === undefined
    ? markdown
    : normalizeMarkdown(editor.state, editor.markdown, markdown);

export interface MarkdownEditorHandle {
  focus: () => void;
  upload: (files: File[]) => void;
}

const AttachTrigger = (props: ComponentProps<"button">) => (
  <button
    {...props}
    className="text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:ring-ring hit-area relative flex size-8 items-center justify-center rounded-md outline-none focus-visible:ring-2 md:size-6 [&_svg]:size-3.5"
    type="button"
  />
);

export const AttachButton = ({
  onFiles,
}: {
  onFiles: (files: File[]) => void;
}) => {
  const input = useRef<HTMLInputElement>(null);

  return (
    <>
      <input
        className="hidden"
        multiple
        onChange={(event) => {
          onFiles([...(event.target.files ?? [])]);
          event.target.value = "";
        }}
        ref={input}
        type="file"
      />
      <Tooltip>
        <TooltipTrigger
          render={
            <AttachTrigger
              aria-label="Attach files"
              onClick={() => {
                input.current?.click();
              }}
            />
          }
        >
          <PaperclipIcon />
        </TooltipTrigger>
        <TooltipContent>Attach files</TooltipContent>
      </Tooltip>
    </>
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

const SourceArea = ({
  autoFocus,
  editable,
  label,
  onCancel,
  onChange,
  onFiles,
  onFocus,
  onSubmit,
  placeholder,
  ref,
  value,
}: {
  autoFocus: boolean;
  editable: boolean;
  label: string;
  onCancel?: () => void;
  onChange: (text: string) => void;
  onFiles?: (files: File[]) => void;
  onFocus: () => void;
  onSubmit?: () => void;
  placeholder?: string;
  ref: Ref<HTMLTextAreaElement>;
  value: string;
}) => {
  const takeFiles = (event: SyntheticEvent, data: DataTransfer) => {
    if (onFiles !== undefined && data.files.length > 0) {
      event.preventDefault();
      onFiles([...data.files]);
    }
  };

  return (
    <textarea
      aria-label={`${label} (Markdown)`}
      autoFocus={autoFocus}
      className="placeholder:text-muted-foreground block field-sizing-content min-h-24 w-full resize-none bg-transparent font-mono text-base leading-6 outline-none md:text-xs md:leading-5"
      onChange={(event) => {
        onChange(event.target.value);
      }}
      onDrop={(event) => {
        takeFiles(event, event.dataTransfer);
      }}
      onFocus={onFocus}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          onSubmit?.();
        } else if (event.key === "Escape") {
          onCancel?.();
          // oxlint-disable-next-line github/no-blur -- Escape leaves the text field, so single-key shortcuts work next.
          event.currentTarget.blur();
        }
      }}
      onPaste={(event) => {
        takeFiles(event, event.clipboardData);
      }}
      placeholder={placeholder}
      readOnly={!editable}
      ref={ref}
      value={value}
    />
  );
};

const download = (href: string) => {
  const anchor = document.createElement("a");

  anchor.href = href;
  anchor.download = "";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
};

// Links open on a plain click in editable and read-only bodies: app links in place, attachments as downloads, anything else in a new tab. A click that ends a text selection keeps the selection.
const useLinkClicks = () => {
  const navigate = useNavigate();

  return (event: MouseEvent) => {
    const anchor =
      event.target instanceof Element
        ? event.target.closest("a[href]:not([data-mention])")
        : null;

    if (
      !(anchor instanceof HTMLAnchorElement) ||
      event.button !== 0 ||
      getSelection()?.isCollapsed === false
    ) {
      return;
    }

    event.preventDefault();

    const url = new URL(anchor.href);
    const local = url.origin === location.origin;
    const modified = event.metaKey || event.ctrlKey || event.shiftKey;

    if (local && url.pathname.startsWith("/files/")) {
      download(url.href);
    } else if (local && !modified && !url.pathname.startsWith("/api/")) {
      void navigate({ href: `${url.pathname}${url.search}${url.hash}` });
    } else {
      window.open(url.href, "_blank", "noopener,noreferrer");
    }
  };
};

const useUploader = (uploadTo: string | undefined): Uploader | null => {
  const queryClient = useQueryClient();

  if (uploadTo === undefined) {
    return null;
  }

  return async (file, onProgress) => {
    const attachment = await uploadFile(uploadTo, file, onProgress);

    void queryClient.invalidateQueries({ queryKey: ["attachments"] });

    return attachment;
  };
};

const useUploadTarget = (
  uploadTo: string | undefined,
  state: RefObject<UploadState>
) => {
  const upload = useUploader(uploadTo);

  return upload === null ? null : createUploadTarget(upload, state);
};

const mediaSelector = ".media > :is(img, video, audio)";

const viewerKind = (element: Element): ViewerItem["kind"] => {
  if (element instanceof HTMLImageElement) {
    return "image";
  }

  return element instanceof HTMLVideoElement ? "video" : "audio";
};

const viewerItem = (element: Element): ViewerItem => {
  const src = element.getAttribute("src") ?? "";
  const alt = element.getAttribute("alt") ?? "";

  return {
    kind: viewerKind(element),
    name: alt === "" ? (src.split("/").at(-1) ?? src) : alt,
    src,
  };
};

const mediaTarget = (root: HTMLElement, target: EventTarget, kind: string) => {
  if (!(target instanceof Element) || !root.contains(target)) {
    return null;
  }

  const expand = target.closest(".media-expand");

  if (expand !== null) {
    return expand.parentElement?.parentElement?.firstElementChild ?? null;
  }

  return target.matches(mediaSelector) && viewerKind(target) === kind
    ? target
    : null;
};

const useMediaViewer = (editor: Editor, path: string | undefined) => {
  const [shown, setShown] = useState<{
    index: number;
    media: ViewerItem[];
  } | null>(null);

  const attachments = useQuery({
    enabled: shown !== null && path !== undefined,
    queryFn: async () => await api<Attachment[]>(path ?? ""),
    queryKey: ["attachments", path],
  });

  const files = new Map(
    (attachments.data ?? []).map((attachment) => [attachment.url, attachment])
  );

  const media = (shown?.media ?? []).map((item) => {
    const file = files.get(item.src);

    return file === undefined
      ? item
      : { ...item, name: file.filename, size: file.size };
  });

  const inDocument = new Set(media.map((item) => item.src));

  const others = [...files.values()].flatMap((file): ViewerItem[] =>
    inDocument.has(file.url)
      ? []
      : [
          {
            kind: mediaKind(file) ?? "file",
            name: file.filename,
            size: file.size,
            src: file.url,
          },
        ]
  );

  const show = (event: MouseEvent, kind: ViewerItem["kind"]) => {
    const root = editor.view.dom;
    const target = mediaTarget(root, event.target, kind);

    if (target === null) {
      return;
    }

    event.preventDefault();

    const elements = [...root.querySelectorAll(mediaSelector)];

    setShown({
      index: elements.indexOf(target),
      media: elements.map(viewerItem),
    });
  };

  return {
    show,
    viewer: (
      <MediaViewer
        index={shown?.index ?? null}
        items={[...media, ...others]}
        onIndex={(index) => {
          setShown((current) =>
            index === null || current === null ? null : { ...current, index }
          );
        }}
      />
    ),
  };
};

const EditorSurface = ({
  attachments,
  editor,
  hidden,
}: {
  attachments?: string;
  editor: Editor;
  hidden: boolean;
}) => {
  const onLinkClick = useLinkClicks();
  const { show, viewer } = useMediaViewer(editor, attachments);
  const table = useTableMenu(editor);

  return (
    <>
      {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- Delegates clicks on links and media inside the editor; links stay keyboard-reachable and the media toolbar opens the viewer by keyboard. */}
      <div
        className={hidden ? "hidden" : undefined}
        onClick={(event) => {
          onLinkClick(event);
          show(event, "image");
        }}
        onContextMenu={table.handleContextMenu}
        onDoubleClick={(event) => {
          show(event, "video");
        }}
      >
        <EditorContent editor={editor} />
      </div>
      {viewer}
      {table.menu}
    </>
  );
};

const useIssueKeys = () => {
  const workspace = useWorkspace();

  return (
    useQuery(projectsQuery(workspace.slug))
      .data?.map((project) => project.key)
      .join(" ") ?? ""
  );
};

export interface MarkdownEditorProps {
  attachments?: string;
  autoFocus?: boolean;
  checkable?: boolean;
  className?: string;
  draft?: DraftRef;
  editable?: boolean;
  label: string;
  onCancel?: () => void;
  onChange?: (markdown: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  ref?: Ref<MarkdownEditorHandle>;
  source?: boolean;
  uploadTo?: string;
  value: string;
}

export const MarkdownEditor = ({
  attachments,
  autoFocus = false,
  checkable = false,
  className,
  draft,
  editable = true,
  label,
  onCancel,
  onChange,
  onSubmit,
  placeholder,
  ref,
  source = false,
  uploadTo,
  value,
}: MarkdownEditorProps) => {
  const keys = useIssueKeys();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  // oxlint-disable-next-line react/hook-use-state -- The gate is created once and never replaced.
  const [gate] = useState(() => createChangeGate(value));

  const live = useRef<
    UploadState & {
      checkable: boolean;
      focused: boolean;
      onCancel?: () => void;
      onSubmit?: () => void;
      pattern: RegExp | null;
      target: UploadTarget | null;
    }
  >({
    checkable,
    draft,
    focused: false,
    onCancel,
    onChange,
    onSubmit,
    pattern: null,
    source,
    target: null,
    value,
  });

  const target = useUploadTarget(uploadTo, live);

  useLayoutEffect(() => {
    Object.assign(live.current, {
      checkable,
      draft,
      onCancel,
      onChange,
      onSubmit,
      source,
      target,
      value,
    });
  });

  const pick = (accept: string) => {
    const input = filePicker.current;

    if (input === null || live.current.target === null) {
      return false;
    }

    input.accept = accept;
    input.click();

    return true;
  };

  const slashMenu = useSlashMenu({
    pick,
    uploads: () => live.current.target !== null,
  });

  const mentionMenu = useMentionMenu();

  const editor = useEditor({
    autofocus: autoFocus && !source ? "end" : false,
    content: value,
    contentType: "markdown",
    editable,
    editorProps: {
      attributes: { "aria-label": label, class: "markdown" },
      handleKeyDown: (view, event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          live.current.onSubmit?.();

          return live.current.onSubmit !== undefined;
        }

        if (
          event.key === "Escape" &&
          !slashMenu.isOpen() &&
          !mentionMenu.isOpen()
        ) {
          live.current.onCancel?.();
          // oxlint-disable-next-line github/no-blur -- Escape leaves the text field, so single-key shortcuts work next.
          view.dom.blur();
        }

        return false;
      },
    },
    extensions: [
      // oxlint-disable-next-line react/refs -- Tiptap calls this on a checkbox click, not during render.
      ...markdownExtensions({
        codeBlockView,
        onReadOnlyChecked: () => live.current.checkable,
      }),
      // oxlint-disable-next-line react/refs -- The shortcut opens the file picker on a key press, not during render.
      BlockKeys.configure({ pick }),
      TableKeys,
      Placeholder.configure({ placeholder: placeholder ?? "" }),
      TaskShortcut,
      // oxlint-disable-next-line react/refs -- The plugin reads the upload target on paste or drop, not during render.
      Uploads.configure({ target: () => live.current.target }),
      IssueMention.configure({ view: issueChipView }),
      PageMention.configure({ view: pageChipView }),
      // oxlint-disable-next-line react/refs -- The plugin reads the pattern after a transaction, not during render.
      Mentions.configure({ pattern: () => live.current.pattern }),
      slashMenu.extension,
      mentionMenu.extension,
    ],
    immediatelyRender: true,
    onFocus: () => {
      live.current.focused = true;
    },
    onUpdate: ({ editor: current }) => {
      if (live.current.source) {
        return;
      }

      const text = gate.change(
        withoutTrailingLines(current.getMarkdown()),
        (markdown) => normalized(current, markdown)
      );

      if (text !== null) {
        live.current.onChange?.(text);
      }
    },
    shouldRerenderOnTransaction: false,
  });

  const uploadToSource = (files: File[]) => {
    const { focused, target: current, value: text } = live.current;

    if (current !== null) {
      const caret = focused ? textarea.current?.selectionEnd : undefined;

      uploadIntoText(files, caret ?? text.length, current);
    }
  };

  useImperativeHandle(ref, () => ({
    focus: () => {
      if (source) {
        textarea.current?.focus();
      } else {
        editor.commands.focus("end");
      }
    },
    upload: (files) => {
      if (source) {
        uploadToSource(files);
      } else if (live.current.target !== null) {
        uploadInto(
          editor,
          files,
          live.current.focused ? editor.state.selection.to : endOf(editor),
          live.current.target
        );
      }
    },
  }));

  useEffect(() => {
    if (!source && value !== gate.emitted()) {
      gate.load(value);

      // Content with chips creates React node views, which cannot render synchronously inside an effect.
      queueMicrotask(() => {
        if (
          !editor.isDestroyed &&
          editor.markdown !== undefined &&
          withoutTrailingLines(editor.getMarkdown()) !==
            normalized(editor, value)
        ) {
          editor.view.dispatch(
            replaceMarkdown(
              editor.state,
              editor.markdown,
              value,
              live.current.pattern
            )
          );
        }
      });
    }
  }, [editor, gate, source, value]);

  const shownSource = useRef(source);

  useEffect(() => {
    if (shownSource.current !== source && editable) {
      if (source) {
        textarea.current?.focus();
      } else {
        queueMicrotask(() => {
          editor.commands.focus("end");
        });
      }
    }

    shownSource.current = source;
  }, [editable, editor, source]);

  useEffect(() => {
    editor.setEditable(editable, false);
  }, [editor, editable]);

  useEffect(() => {
    live.current.pattern = issueKeyPattern(keys === "" ? [] : keys.split(" "));

    queueMicrotask(() => {
      if (!editor.isDestroyed) {
        editor.view.dispatch(editor.state.tr.setMeta(mentionsKey, true));
      }
    });
  }, [editor, keys]);

  return (
    <div className={cn("relative min-w-0", className)}>
      {source ? (
        <SourceArea
          autoFocus={autoFocus}
          editable={editable}
          label={label}
          onCancel={onCancel}
          onChange={(text) => {
            live.current.value = text;
            onChange?.(text);
          }}
          onFiles={target === null ? undefined : uploadToSource}
          onFocus={() => {
            live.current.focused = true;
          }}
          onSubmit={onSubmit}
          placeholder={placeholder}
          ref={textarea}
          value={value}
        />
      ) : null}
      <EditorSurface
        attachments={attachments ?? uploadTo}
        editor={editor}
        hidden={source}
      />
      {editable && target !== null ? (
        <input
          aria-hidden
          className="hidden"
          multiple
          onChange={(event) => {
            const picked = [...(event.target.files ?? [])];

            event.target.value = "";
            uploadInto(
              editor,
              picked,
              editor.state.selection.to,
              live.current.target ?? target
            );
          }}
          ref={filePicker}
          tabIndex={-1}
          type="file"
        />
      ) : null}
      {editable && !source ? <Bubble editor={editor} /> : null}
      {slashMenu.menu}
      {mentionMenu.menu}
    </div>
  );
};
