import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { Mark, Node as ProseMirrorNode } from "@tiptap/pm/model";
import { cn } from "cn";
import { ChevronRightIcon } from "lucide-react";
import {
  createElement,
  Fragment,
  lazy,
  Suspense,
  useRef,
  useState,
} from "react";
import type { MouseEvent, ReactElement, ReactNode, RefObject } from "react";
// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import { CodeFrame, Diagram } from "~/components/code-block-view";
import { loadEditor } from "~/components/editor-chunk";
import { LazyMarkdownEditor } from "~/components/lazy-editor";
import type { MarkdownEditorProps } from "~/components/markdown-editor";
import { MediaViewer } from "~/components/media-viewer";
import type { ViewerItem } from "~/components/media-viewer";
import { IssueChip, PageChip } from "~/components/mention-chip";
import { api } from "~/lib/api";
import type { Attachment } from "~/lib/api-types";
import { isSafeUrl } from "~/lib/markdown";
import { checkTask, parseDoc } from "~/lib/markdown-doc";
import { mediaKind } from "~/lib/media-html";
import { downloadMedia, isSafeSource, mediaIcons } from "~/lib/media-view";
import { projectsQuery } from "~/lib/queries";
import { useWorkspace } from "~/lib/use-workspace";

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
    element: element instanceof HTMLImageElement ? element : undefined,
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

const useMediaViewer = (
  root: RefObject<HTMLElement | null>,
  path: string | undefined
) => {
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
    const element = root.current;

    const target =
      element === null ? null : mediaTarget(element, event.target, kind);

    if (element === null || target === null) {
      return;
    }

    event.preventDefault();

    const elements = [...element.querySelectorAll(mediaSelector)];

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

export const MarkdownFrame = ({
  attachments,
  children,
  hidden = false,
  onContextMenu,
}: {
  attachments?: string;
  children: ReactNode;
  hidden?: boolean;
  onContextMenu?: (event: MouseEvent) => void;
}) => {
  const root = useRef<HTMLDivElement>(null);
  const onLinkClick = useLinkClicks();
  const { show, viewer } = useMediaViewer(root, attachments);

  return (
    <>
      {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- Delegates clicks on links and media inside the body; links stay keyboard-reachable and the media toolbar opens the viewer by keyboard. */}
      <div
        className={hidden ? "hidden" : undefined}
        onClick={(event) => {
          onLinkClick(event);
          show(event, "image");
        }}
        onContextMenu={onContextMenu}
        onDoubleClick={(event) => {
          show(event, "video");
        }}
        ref={root}
      >
        {children}
      </div>
      {viewer}
    </>
  );
};

export const useIssueKeys = () => {
  const workspace = useWorkspace();

  return (
    useQuery(projectsQuery(workspace.slug))
      .data?.map((project) => project.key)
      .join(" ") ?? ""
  );
};

const Highlighted = lazy(async () => {
  const { highlightSegments } = await import("~/lib/code-languages");

  return {
    default: ({
      code,
      language,
    }: {
      code: string;
      language: string | null;
    }) => (
      <>
        {highlightSegments(language, code).map(({ classes, from, text }) =>
          classes.length === 0 ? (
            <Fragment key={from}>{text}</Fragment>
          ) : (
            <span className={classes.join(" ")} key={from}>
              {text}
            </span>
          )
        )}
      </>
    ),
  };
});

const CodeBlock = ({
  code,
  language,
}: {
  code: string;
  language: string | null;
}) => {
  if (language === "mermaid") {
    return (
      <div
        className="group/code relative whitespace-normal"
        data-diagram=""
        data-selected={false}
      >
        <Diagram code={code} />
      </div>
    );
  }

  return (
    <div className="group/code relative whitespace-normal">
      <CodeFrame code={code}>
        <code className="min-w-0 flex-1 whitespace-pre-wrap">
          <Suspense fallback={code}>
            <Highlighted code={code} language={language} />
          </Suspense>
          {code === "" || code.endsWith("\n") ? <br /> : null}
        </code>
      </CodeFrame>
    </div>
  );
};

const MediaIcon = ({ name }: { name: keyof typeof mediaIcons }) => (
  <svg aria-hidden viewBox="0 0 24 24">
    {mediaIcons[name].map((path) => (
      <path d={path} key={path} />
    ))}
  </svg>
);

const MediaAttributesSchema = v.object({
  alt: v.optional(v.nullable(v.string())),
  src: v.nullable(v.string()),
  width: v.optional(v.nullable(v.number())),
});

const Media = ({ node }: { node: ProseMirrorNode }) => {
  const { alt, src, width } = v.parse(MediaAttributesSchema, node.attrs);
  const safe = src !== null && isSafeSource(src) ? src : undefined;

  const props = {
    src: safe,
    width: width ?? undefined,
  };

  return (
    <div className="media">
      {node.type.name === "image" ? (
        <img alt={alt ?? undefined} draggable={false} {...props} />
      ) : null}
      {node.type.name === "video" ? (
        <video controls preload="metadata" {...props}>
          <track kind="captions" />
        </video>
      ) : null}
      {node.type.name === "audio" ? (
        <audio controls preload="metadata" src={safe}>
          <track kind="captions" />
        </audio>
      ) : (
        <div className="media-toolbar">
          <button
            aria-label="Open in viewer"
            // oxlint-disable-next-line shadcn/no-unknown-classes -- The class marks the button that opens the viewer, as in the editor's media view.
            className="media-expand"
            type="button"
          >
            <MediaIcon name="expand" />
          </button>
          <button
            aria-label="Download"
            // oxlint-disable-next-line shadcn/no-unknown-classes -- The class matches the editor's media view.
            className="media-download"
            onClick={() => {
              downloadMedia(safe ?? "");
            }}
            type="button"
          >
            <MediaIcon name="download" />
          </button>
        </div>
      )}
    </div>
  );
};

const Details = ({
  children,
  open: initial,
  summary,
}: {
  children: ReactNode;
  open: boolean;
  summary: ReactNode;
}) => {
  const [open, setOpen] = useState(initial);

  return (
    <div className={open ? "is-open" : undefined} data-type="details">
      <button
        aria-expanded={open}
        aria-label={open ? "Collapse" : "Expand"}
        onClick={() => {
          setOpen(!open);
        }}
        type="button"
      >
        <ChevronRightIcon aria-hidden />
      </button>
      <div>
        {summary}
        <div data-type="detailsContent" hidden={!open}>
          {children}
        </div>
      </div>
    </div>
  );
};

const LinkSchema = v.object({
  class: v.nullable(v.string()),
  href: v.string(),
  rel: v.nullable(v.string()),
  target: v.nullable(v.string()),
  title: v.nullable(v.string()),
});

const markElement = (mark: Mark, children: ReactNode) => {
  switch (mark.type.name) {
    case "bold": {
      return <strong>{children}</strong>;
    }

    case "italic": {
      return <em>{children}</em>;
    }

    case "strike": {
      return <s>{children}</s>;
    }

    case "code": {
      return <code>{children}</code>;
    }

    case "link": {
      const link = v.parse(LinkSchema, mark.attrs);

      return (
        // oxlint-disable-next-line github/a11y-no-title-attribute -- A Markdown link title shows as it does in the editor.
        <a
          className={link.class ?? undefined}
          href={isSafeUrl(link.href) ? link.href : ""}
          rel={link.rel ?? undefined}
          target={link.target ?? undefined}
          title={link.title ?? undefined}
        >
          {children}
        </a>
      );
    }

    default: {
      return <span>{children}</span>;
    }
  }
};

interface Child {
  node: ProseMirrorNode;
  pos: number;
}

type Render = (child: Child) => ReactElement;

const childrenOf = (node: ProseMirrorNode, start: number) => {
  const children: Child[] = [];
  let pos = start;

  for (const child of node.children) {
    children.push({ node: child, pos });
    pos += child.nodeSize;
  }

  return children;
};

const renderInline = (
  children: Child[],
  depth: number,
  render: Render
): ReactElement[] => {
  const groups: { children: Child[]; mark: Mark | undefined }[] = [];

  for (const child of children) {
    const mark = child.node.marks[depth];
    const last = groups.at(-1);

    if (mark !== undefined && last?.mark?.eq(mark) === true) {
      last.children.push(child);
    } else {
      groups.push({ children: [child], mark });
    }
  }

  return groups.flatMap(({ children: group, mark }) => {
    const [first] = group;

    if (first === undefined) {
      return [];
    }

    if (mark !== undefined) {
      return [
        <Fragment key={first.pos}>
          {markElement(mark, renderInline(group, depth + 1, render))}
        </Fragment>,
      ];
    }

    return [render(first)];
  });
};

const needsBreak = (node: ProseMirrorNode) => {
  const last = node.lastChild;

  return last === null || !last.isText || (last.text ?? "").endsWith("\n");
};

const renderContent = (
  node: ProseMirrorNode,
  start: number,
  render: Render
): ReactElement[] => {
  const children = childrenOf(node, start);

  if (!node.inlineContent) {
    return children.map(render);
  }

  const inline = renderInline(children, 0, render);

  return needsBreak(node)
    ? [...inline, <br className="ProseMirror-trailingBreak" key="break" />]
    : inline;
};

const plainTags = new Map<string, string>([
  ["blockquote", "blockquote"],
  ["bulletList", "ul"],
  ["detailsSummary", "summary"],
  ["listItem", "li"],
  ["paragraph", "p"],
  ["tableRow", "tr"],
]);

const alignClasses = new Map([
  ["center", "text-center"],
  ["left", "text-left"],
  ["right", "text-right"],
]);

const OrderedListSchema = v.object({
  start: v.number(),
  type: v.nullable(v.picklist(["1", "a", "A", "i", "I"])),
});

const taskLabel = (node: ProseMirrorNode) =>
  `Task item checkbox for ${node.textContent || "empty task item"}`;

const renderLeaf = (node: ProseMirrorNode) => {
  const { attrs } = node;

  switch (node.type.name) {
    case "horizontalRule": {
      return <hr />;
    }

    case "hardBreak": {
      return <br />;
    }

    case "issueMention": {
      return <IssueChip issueKey={String(attrs["key"] ?? "")} />;
    }

    case "pageMention": {
      return (
        <PageChip
          href={String(attrs["href"] ?? "")}
          label={String(attrs["label"] ?? "")}
        />
      );
    }

    default: {
      return <Media node={node} />;
    }
  }
};

const renderBlock = (
  { node, pos }: Child,
  content: () => ReactElement[],
  check: (pos: number, checked: boolean) => void
) => {
  const { attrs } = node;
  const tag = plainTags.get(node.type.name);

  if (tag !== undefined) {
    return createElement(tag, null, content());
  }

  switch (node.type.name) {
    case "heading": {
      return createElement(`h${Number(attrs["level"] ?? 1)}`, null, content());
    }

    case "orderedList": {
      const { start, type } = v.parse(OrderedListSchema, attrs);

      return (
        <ol start={start === 1 ? undefined : start} type={type ?? undefined}>
          {content()}
        </ol>
      );
    }

    case "taskList": {
      return <ul data-type="taskList">{content()}</ul>;
    }

    case "taskItem": {
      const checked = attrs["checked"] === true;

      return (
        <li data-checked={checked}>
          <label>
            <input
              aria-label={taskLabel(node)}
              checked={checked}
              onChange={(event) => {
                check(pos, event.target.checked);
              }}
              type="checkbox"
            />
            <span className="sr-only">{taskLabel(node)}</span>
          </label>
          <div>{content()}</div>
        </li>
      );
    }

    case "table": {
      return (
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- A wide table scrolls inside its wrapper, so the wrapper takes focus for keyboard scrolling.
        <div className="tableWrapper" tabIndex={0}>
          <table>
            <tbody>{content()}</tbody>
          </table>
        </div>
      );
    }

    case "tableCell":
    case "tableHeader": {
      return createElement(
        node.type.name === "tableCell" ? "td" : "th",
        { className: alignClasses.get(String(attrs["align"])) },
        content()
      );
    }

    case "codeBlock": {
      return (
        <div>
          <CodeBlock
            code={node.textContent}
            language={String(attrs["language"] ?? "") || null}
          />
        </div>
      );
    }

    default: {
      return <>{content()}</>;
    }
  }
};

const renderNode = (
  child: Child,
  check: (pos: number, checked: boolean) => void
): ReactElement => {
  const { node, pos } = child;

  const render = (next: Child) => renderNode(next, check);

  if (node.isText) {
    return <Fragment key={pos}>{node.text}</Fragment>;
  }

  if (node.isLeaf) {
    return <Fragment key={pos}>{renderLeaf(node)}</Fragment>;
  }

  if (node.type.name === "details") {
    const [summary, body] = childrenOf(node, pos + 1);

    return (
      <Details
        key={pos}
        open={node.attrs["open"] === true}
        summary={summary === undefined ? null : render(summary)}
      >
        {body === undefined
          ? null
          : renderContent(body.node, body.pos + 1, render)}
      </Details>
    );
  }

  return (
    <Fragment key={pos}>
      {renderBlock(child, () => renderContent(node, pos + 1, render), check)}
    </Fragment>
  );
};

const isEmpty = (doc: ProseMirrorNode) =>
  doc.childCount === 1 && doc.firstChild?.content.size === 0;

export const MarkdownView = ({
  attachments,
  checkable = false,
  className,
  editable = false,
  onChange,
  placeholder,
  value,
}: {
  attachments?: string;
  checkable?: boolean;
  className?: string;
  editable?: boolean;
  onChange?: (markdown: string) => void;
  placeholder?: string;
  value: string;
}) => {
  const keys = useIssueKeys();
  const doc = parseDoc(value, keys === "" ? [] : keys.split(" "));

  const check = (pos: number, checked: boolean) => {
    if (checkable) {
      onChange?.(checkTask(doc, pos, checked));
    }
  };

  return (
    <div className={cn("relative min-w-0", className)}>
      <MarkdownFrame attachments={attachments}>
        <div className="markdown" data-editable={editable ? "" : undefined}>
          {placeholder !== undefined && isEmpty(doc) ? (
            <p className="is-editor-empty" data-placeholder={placeholder}>
              <br className="ProseMirror-trailingBreak" />
            </p>
          ) : (
            renderContent(doc, 0, (child) => renderNode(child, check))
          )}
        </div>
      </MarkdownFrame>
    </div>
  );
};

void loadEditor();

export const MarkdownField = (props: MarkdownEditorProps) => {
  const { attachments, editable = true, uploadTo } = props;

  return (
    <LazyMarkdownEditor
      {...props}
      fallback={
        <MarkdownView
          attachments={
            attachments === null ? undefined : (attachments ?? uploadTo)
          }
          className={props.className}
          editable={editable}
          placeholder={editable ? props.placeholder : undefined}
          value={props.value}
        />
      }
    />
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
