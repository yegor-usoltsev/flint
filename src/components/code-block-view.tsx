import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  NodeViewContent,
  NodeViewWrapper,
  useEditorState,
} from "@tiptap/react";
import type { ReactNodeViewProps } from "@tiptap/react";
import { cn } from "cn";
import {
  ChevronDownIcon,
  CodeXmlIcon,
  CopyIcon,
  EllipsisIcon,
  Maximize2Icon,
  SlidersHorizontalIcon,
  Trash2Icon,
  WorkflowIcon,
} from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { MediaViewer } from "~/components/media-viewer";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { Skeleton } from "~/components/ui/skeleton";
import { Switch } from "~/components/ui/switch";
import {
  codeLanguages,
  detectLanguage,
  languageId,
  languageLabel,
} from "~/lib/code-languages";
import { copyText } from "~/lib/copy";
import {
  diagramImage,
  diagramQuery,
  diagramSize,
  parseDiagram,
  useDarkTheme,
} from "~/lib/mermaid";
import { themeColors } from "~/lib/theme";

const Toolbar = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      "bg-popover absolute top-1.5 right-1.5 flex items-center gap-0.5 rounded-full border p-0.5 opacity-0 transition-opacity duration-150 group-hover/code:opacity-100 group-data-active/code:opacity-100 group-data-selected/code:opacity-100 focus-within:opacity-100 has-data-popup-open:opacity-100",
      className
    )}
    contentEditable={false}
  >
    {children}
  </div>
);

const ToolbarButton = ({
  children,
  label,
  onClick,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
}) => (
  <Button aria-label={label} onClick={onClick} size="icon-xs" variant="ghost">
    {children}
  </Button>
);

const LanguagePicker = ({
  code,
  language,
  onChange,
}: {
  code: string;
  language: string | null;
  onChange: (language: string | null) => void;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger
      render={<Button aria-label="Change language" size="xs" variant="ghost" />}
    >
      {language === null ? detectLanguage(code) : languageLabel(language)}
      <ChevronDownIcon />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="max-h-80 w-48" tabIndex={0}>
      <DropdownMenuRadioGroup
        onValueChange={(value: string) => {
          onChange(value === "" ? null : value);
        }}
        value={language === null ? "" : languageId(language)}
      >
        <DropdownMenuRadioItem value="">Auto detect</DropdownMenuRadioItem>
        <DropdownMenuSeparator />
        {codeLanguages.map(({ id, label }) => (
          <DropdownMenuRadioItem key={id} value={id}>
            {label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
);

const Toggle = ({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) => (
  <label className="flex h-7 items-center justify-between gap-6">
    {label}
    <Switch checked={checked} onCheckedChange={onChange} size="sm" />
  </label>
);

const DisplayOptions = ({
  numbers,
  setNumbers,
  setWrap,
  wrap,
}: {
  numbers: boolean;
  setNumbers: (numbers: boolean) => void;
  setWrap: (wrap: boolean) => void;
  wrap: boolean;
}) => (
  <Popover>
    <PopoverTrigger
      render={
        <Button aria-label="Display options" size="icon-xs" variant="ghost" />
      }
    >
      <SlidersHorizontalIcon />
    </PopoverTrigger>
    <PopoverContent aria-label="Display options" align="end" className="w-52">
      <div>
        <Toggle checked={wrap} label="Wrap lines" onChange={setWrap} />
        <Toggle
          checked={numbers}
          label="Show line numbers"
          onChange={setNumbers}
        />
      </div>
    </PopoverContent>
  </Popover>
);

const useEditable = (editor: ReactNodeViewProps["editor"]) =>
  useEditorState({
    editor,
    selector: ({ editor: current }) => current.isEditable,
  });

const CodeBlock = ({
  editor,
  node,
  selectionInside,
  updateAttributes,
}: ReactNodeViewProps) => {
  const [wrap, setWrap] = useState(false);
  const [numbers, setNumbers] = useState(true);
  const editable = useEditable(editor);

  const code = node.textContent;
  const language = String(node.attrs["language"] ?? "") || null;
  const lines = code.split("\n").length;

  return (
    <NodeViewWrapper
      className="group/code relative"
      data-active={selectionInside === true ? "" : undefined}
    >
      <pre className="flex">
        {numbers ? (
          <span
            aria-hidden
            className="text-muted-foreground bg-surface-2 sticky -left-3 -ml-3 shrink-0 pr-3 pl-3 text-right whitespace-pre! select-none"
            contentEditable={false}
          >
            {Array.from({ length: lines }, (_, index) => index + 1).join("\n")}
          </span>
        ) : null}
        <NodeViewContent<"code">
          as="code"
          className={cn(
            "min-w-0 flex-1",
            wrap ? "break-words whitespace-pre-wrap" : "whitespace-pre"
          )}
        />
      </pre>
      <Toolbar>
        {editable ? (
          <LanguagePicker
            code={code}
            language={language}
            onChange={(next) => {
              updateAttributes({ language: next });
            }}
          />
        ) : null}
        <DisplayOptions
          numbers={numbers}
          setNumbers={setNumbers}
          setWrap={setWrap}
          wrap={wrap}
        />
        <ToolbarButton
          label="Copy"
          onClick={() => {
            void copyText(code, "code");
          }}
        >
          <CopyIcon />
        </ToolbarButton>
      </Toolbar>
    </NodeViewWrapper>
  );
};

const errorMessage = (error: Error | null) =>
  error?.message.split("\n").find((line) => line.trim() !== "") ??
  "Invalid diagram";

const statusClass = "text-muted-foreground mt-1 px-1 font-sans text-xs";

const coarsePointer = () => window.matchMedia("(pointer: coarse)").matches;

const diagramFrame =
  "group-data-selected/code:ring-ring flex min-h-16 justify-center overflow-x-auto rounded-lg border p-4 group-data-selected/code:ring-2";

const useDiagramViewer = () => {
  const [src, setSrc] = useState<string | null>(null);

  const open = (svg: string, dark: boolean) => {
    const image = diagramImage(svg, dark ? null : themeColors.light);

    if (image !== null) {
      setSrc(image);
    }
  };

  const viewer = (
    <MediaViewer
      index={src === null ? null : 0}
      items={src === null ? [] : [{ kind: "image", name: "Diagram.svg", src }]}
      onIndex={(index) => {
        if (index === null && src !== null) {
          URL.revokeObjectURL(src);
          setSrc(null);
        }
      }}
    />
  );

  return { open, viewer };
};

const Diagram = ({
  code,
  menu,
  onSelect,
}: {
  code: string;
  menu?: ReactNode;
  onSelect?: () => void;
}) => {
  const dark = useDarkTheme();
  const viewer = useDiagramViewer();
  const empty = code.trim() === "";
  const size = diagramSize(code);

  const diagram = useQuery({
    ...diagramQuery(code, dark),
    enabled: !empty,
    placeholderData: keepPreviousData,
  });

  if (diagram.isError && diagram.data === undefined) {
    return <p className={statusClass}>{errorMessage(diagram.error)}</p>;
  }

  const svg = empty ? "" : diagram.data;

  if (svg === undefined) {
    return (
      <div aria-busy className={diagramFrame}>
        <Skeleton
          className={cn(
            "max-w-full",
            size === undefined
              ? "h-40 w-full max-w-lg"
              : "aspect-(--diagram-ratio) w-(--diagram-width)"
          )}
          style={
            size === undefined
              ? undefined
              : {
                  "--diagram-ratio": `${size.width} / ${size.height}`,
                  "--diagram-width": `${size.width}px`,
                }
          }
        />
      </div>
    );
  }

  const expand = () => {
    viewer.open(svg, dark);
  };

  const frame = cn(diagramFrame, "[&_svg]:h-auto [&_svg]:max-w-full");

  return (
    <>
      {onSelect === undefined ? (
        <button
          aria-label="Expand diagram"
          className={cn(frame, "w-full cursor-zoom-in")}
          // oxlint-disable-next-line react/no-danger -- Mermaid renders with securityLevel "strict", which sanitizes labels with DOMPurify.
          dangerouslySetInnerHTML={{ __html: svg }}
          disabled={svg === ""}
          onClick={expand}
          type="button"
        />
      ) : (
        // oxlint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- A click selects the block like any atom, a tap zooms it like an image; the toolbar's Expand and menu buttons reach both by keyboard.
        <div
          className={frame}
          // oxlint-disable-next-line react/no-danger -- Mermaid renders with securityLevel "strict", which sanitizes labels with DOMPurify.
          dangerouslySetInnerHTML={{ __html: svg }}
          onClick={() => {
            if (svg !== "" && coarsePointer()) {
              expand();
            }
          }}
          onMouseDown={(event) => {
            if (!coarsePointer()) {
              event.preventDefault();
              onSelect();
            }
          }}
        />
      )}
      {menu === undefined ? null : (
        <Toolbar className="pointer-coarse:opacity-100">
          {svg === "" ? null : (
            <ToolbarButton label="Expand diagram" onClick={expand}>
              <Maximize2Icon />
            </ToolbarButton>
          )}
          {menu}
        </Toolbar>
      )}
      {viewer.viewer}
    </>
  );
};

const DiagramStatus = ({ code }: { code: string }) => {
  const parsed = useQuery({
    placeholderData: keepPreviousData,
    queryFn: async () => await parseDiagram(code),
    queryKey: ["mermaid", "parse", code],
    retry: false,
    staleTime: "static",
  });

  return (
    <p className={statusClass} contentEditable={false}>
      {parsed.isError ? errorMessage(parsed.error) : "No errors found"}
    </p>
  );
};

const DiagramMenu = ({
  onDelete,
  onShowSource,
  code,
}: {
  code: string;
  onDelete: () => void;
  onShowSource: () => void;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger
      render={<Button aria-label="Open menu" size="icon-xs" variant="ghost" />}
    >
      <EllipsisIcon />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-44">
      <DropdownMenuItem
        onClick={() => {
          void copyText(code, "diagram source");
        }}
      >
        <CopyIcon />
        Copy source
      </DropdownMenuItem>
      <DropdownMenuItem onClick={onShowSource}>
        <CodeXmlIcon />
        Show source
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={onDelete}>
        <Trash2Icon />
        Delete
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);

const DiagramBlock = ({
  deleteNode,
  editor,
  getPos,
  node,
  selected,
  selectionInside,
}: ReactNodeViewProps) => {
  const [source, setSource] = useState(node.textContent === "");
  const editable = useEditable(editor);

  const code = node.textContent;

  const showSource =
    editable && (source || selectionInside === true || code.trim() === "");

  const select = () => {
    const pos = getPos();

    if (pos !== undefined) {
      editor.chain().focus().setNodeSelection(pos).run();
    }
  };

  return (
    <NodeViewWrapper
      className="group/code relative"
      data-active={selectionInside === true ? "" : undefined}
      data-selected={selected}
    >
      <pre className="relative" hidden={!showSource}>
        {code === "" ? (
          <span
            className="text-muted-foreground pointer-events-none absolute select-none"
            contentEditable={false}
          >
            Describe your diagram in Mermaid…
          </span>
        ) : null}
        <NodeViewContent<"code"> as="code" className="block whitespace-pre" />
      </pre>
      {showSource ? (
        <>
          {code.trim() === "" ? null : <DiagramStatus code={code} />}
          <Toolbar>
            <ToolbarButton
              label="Copy"
              onClick={() => {
                void copyText(code, "diagram source");
              }}
            >
              <CopyIcon />
            </ToolbarButton>
            <ToolbarButton
              label="Show diagram"
              onClick={() => {
                setSource(false);
                select();
              }}
            >
              <WorkflowIcon />
            </ToolbarButton>
          </Toolbar>
        </>
      ) : (
        <Diagram
          code={code}
          menu={
            editable ? (
              <DiagramMenu
                code={code}
                onDelete={deleteNode}
                onShowSource={() => {
                  setSource(true);
                }}
              />
            ) : undefined
          }
          onSelect={editable ? select : undefined}
        />
      )}
    </NodeViewWrapper>
  );
};

export const codeBlockView = (props: ReactNodeViewProps) =>
  props.node.attrs["language"] === "mermaid" ? (
    <DiagramBlock {...props} />
  ) : (
    <CodeBlock {...props} />
  );
