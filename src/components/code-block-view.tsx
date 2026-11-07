import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
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
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { MouseEvent, ReactNode, RefObject, UIEvent } from "react";

import { MediaViewer } from "~/components/media-viewer";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogPortal,
  DialogTitle,
} from "~/components/ui/dialog";
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
  diagramVars,
  fitsColumn,
  parseDiagram,
  smallestLabel,
  svgSize,
  useDarkTheme,
} from "~/lib/mermaid";
import type { DiagramSize } from "~/lib/mermaid";
import { rootRem } from "~/lib/rem";
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
  className,
  label,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  label: string;
  onClick: () => void;
}) => (
  <Button
    aria-label={label}
    className={className}
    onClick={onClick}
    size="icon-xs"
    variant="ghost"
  >
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

const phoneQuery = "(width < 40rem)";

const diagramFrame =
  "group-data-selected/code:ring-ring flex min-h-16 justify-center-safe overflow-x-auto rounded-lg border p-4 group-data-selected/code:ring-2";

const DiagramSheet = ({
  onClose,
  src,
}: {
  onClose: () => void;
  src: string | null;
}) => (
  <Dialog
    onOpenChange={(open) => {
      if (!open) {
        onClose();
      }
    }}
    open={src !== null}
  >
    <DialogPortal>
      <DialogPrimitive.Popup className="bg-background fixed inset-0 z-50 flex flex-col outline-none">
        <div className="flex h-14 shrink-0 items-center justify-between border-b pr-1.5 pl-4">
          <DialogTitle>Diagram</DialogTitle>
          <DialogClose
            render={
              <Button
                aria-label="Close"
                className="size-11"
                size="icon-lg"
                variant="ghost"
              />
            }
          >
            <XIcon />
          </DialogClose>
        </div>
        <section
          aria-label="Diagram at full size"
          className="focus-visible:ring-ring/50 flex min-h-0 flex-1 overflow-auto overscroll-contain p-4 outline-none focus-visible:ring-3 focus-visible:ring-inset"
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The diagram scrolls on both axes, so the region takes focus for keyboard scrolling.
          tabIndex={0}
        >
          {src === null ? null : (
            <img alt="Diagram" className="m-auto max-w-none" src={src} />
          )}
        </section>
      </DialogPrimitive.Popup>
    </DialogPortal>
  </Dialog>
);

const useDiagramViewer = () => {
  const [src, setSrc] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);

  useEffect(
    () => () => {
      if (src !== null) {
        URL.revokeObjectURL(src);
      }
    },
    [src]
  );

  const open = (svg: string, dark: boolean) => {
    const phone = window.matchMedia(phoneQuery).matches;
    const background = dark ? themeColors.dark : themeColors.light;
    const image = diagramImage(svg, phone ? null : background);

    if (image !== null) {
      setSheet(phone);
      setSrc(image);
    }
  };

  const close = () => {
    setSrc(null);
  };

  const viewer = sheet ? (
    <DiagramSheet onClose={close} src={src} />
  ) : (
    <MediaViewer
      index={src === null ? null : 0}
      items={src === null ? [] : [{ kind: "image", name: "Diagram.svg", src }]}
      onIndex={(index) => {
        if (index === null) {
          close();
        }
      }}
    />
  );

  return { open, viewer };
};

const selectOnMouseDown =
  (onSelect: (() => void) | undefined) => (event: MouseEvent) => {
    if (onSelect !== undefined && !coarsePointer()) {
      event.preventDefault();
      onSelect();
    }
  };

const scrollsOn = (element: HTMLElement) =>
  element.scrollLeft + element.clientWidth < element.scrollWidth - 1;

const useDiagramFit = (
  frame: RefObject<HTMLElement | null>,
  size: DiagramSize | undefined,
  smallest: number | undefined
) => {
  const [fit, setFit] = useState(false);
  const [fade, setFade] = useState(false);

  useEffect(() => {
    const element = frame.current;

    const measure = () => {
      if (element === null) {
        return;
      }

      const available = element.clientWidth - 2 * rootRem();

      setFit(
        size !== undefined &&
          window.matchMedia(phoneQuery).matches &&
          fitsColumn(size, available, smallest)
      );

      setFade(scrollsOn(element));
    };

    const observer = new ResizeObserver(measure);

    if (element !== null) {
      measure();
      observer.observe(element);

      for (const child of element.children) {
        observer.observe(child);
      }
    }

    return () => {
      observer.disconnect();
    };
  }, [frame, size, smallest]);

  return {
    fade,
    fit,
    handleScroll: (event: UIEvent<HTMLElement>) => {
      setFade(scrollsOn(event.currentTarget));
    },
  };
};

const DiagramFrame = ({
  children,
  onExpand,
  onSelect,
  size,
  svg,
}: {
  children: ReactNode;
  onExpand: () => void;
  onSelect?: () => void;
  size: DiagramSize | undefined;
  svg: string | undefined;
}) => {
  const ref = useRef<HTMLElement>(null);
  const shown = svg === undefined || svg === "" ? undefined : svgSize(svg);
  const measured = shown ?? size;

  const smallest = svg === undefined ? undefined : smallestLabel(svg);
  const { fade, fit, handleScroll } = useDiagramFit(ref, shown, smallest);

  const vars =
    measured === undefined ? undefined : diagramVars(measured, smallest);

  const style =
    vars === undefined
      ? undefined
      : {
          "--diagram-min": vars.min,
          "--diagram-ratio": vars.ratio,
          "--diagram-width": vars.width,
        };

  return (
    <div className="diagram-frame relative" style={style}>
      {svg === undefined ? (
        // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- A click on the placeholder selects the block like the rendered diagram; the toolbar reaches it by keyboard.
        <div
          aria-busy
          className={diagramFrame}
          onMouseDown={selectOnMouseDown(onSelect)}
        >
          <Skeleton
            className={cn(
              "max-w-full",
              size === undefined
                ? "h-40 w-full max-w-lg"
                : "aspect-(--diagram-ratio) w-(--diagram-width)"
            )}
          />
        </div>
      ) : (
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events -- A click selects the block like any atom, a tap zooms it like an image; the toolbar's Expand and menu buttons reach both by keyboard.
        <section
          aria-label="Diagram"
          className={cn(
            diagramFrame,
            "focus-visible:ring-ring/50 outline-none focus-visible:ring-3",
            onSelect === undefined && svg !== "" && "cursor-zoom-in"
          )}
          data-fade={fade ? "" : undefined}
          data-fit={fit ? "" : undefined}
          // oxlint-disable-next-line react/no-danger -- Mermaid renders with securityLevel "strict", which sanitizes labels with DOMPurify.
          dangerouslySetInnerHTML={{ __html: svg }}
          onClick={() => {
            if (svg !== "" && (onSelect === undefined || coarsePointer())) {
              onExpand();
            }
          }}
          onMouseDown={selectOnMouseDown(onSelect)}
          ref={ref}
          onScroll={handleScroll}
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- A wide diagram scrolls inside its frame, so the frame takes focus for keyboard scrolling.
          tabIndex={0}
        />
      )}
      {children}
    </div>
  );
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

  const svg = empty ? "" : diagram.data;
  const failed = diagram.isError && diagram.data === undefined;
  const ready = svg !== undefined && svg !== "";

  const expand = () => {
    if (svg !== undefined) {
      viewer.open(svg, dark);
    }
  };

  const toolbar =
    menu === undefined && !ready ? null : (
      <Toolbar
        className={cn(
          "pointer-coarse:opacity-100",
          menu === undefined && "max-sm:hidden",
          menu !== undefined && "max-sm:top-2.5 max-sm:right-14"
        )}
      >
        {ready ? (
          <ToolbarButton
            className="max-sm:hidden"
            label="Expand diagram"
            onClick={expand}
          >
            <Maximize2Icon />
          </ToolbarButton>
        ) : null}
        {menu}
      </Toolbar>
    );

  return (
    <>
      {failed ? (
        <>
          <p className={statusClass}>{errorMessage(diagram.error)}</p>
          {toolbar}
        </>
      ) : (
        <DiagramFrame
          onExpand={expand}
          onSelect={onSelect}
          size={size}
          svg={svg}
        >
          {ready ? (
            <Button
              aria-label="Expand diagram"
              className="absolute top-1 right-1 size-11 sm:hidden"
              contentEditable={false}
              onClick={expand}
              size="icon-lg"
              variant="outline"
            >
              <Maximize2Icon />
            </Button>
          ) : null}
          {toolbar}
        </DiagramFrame>
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
      data-diagram={showSource ? undefined : ""}
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
