import {
  NodeViewContent,
  NodeViewWrapper,
  useEditorState,
} from "@tiptap/react";
import type { ReactNodeViewProps } from "@tiptap/react";
import {
  ChevronDownIcon,
  CodeXmlIcon,
  CopyIcon,
  EllipsisIcon,
  Trash2Icon,
  WorkflowIcon,
} from "lucide-react";
import { useState } from "react";

import {
  CodeFrame,
  Diagram,
  DiagramStatus,
  Toolbar,
  ToolbarButton,
} from "~/components/code-block-view";
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
  codeLanguages,
  detectLanguage,
  languageId,
  languageLabel,
} from "~/lib/code-languages";
import { copyText } from "~/lib/copy";

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
  const editable = useEditable(editor);
  const code = node.textContent;
  const language = String(node.attrs["language"] ?? "") || null;

  return (
    <NodeViewWrapper
      className="group/code relative"
      data-active={selectionInside === true ? "" : undefined}
    >
      <CodeFrame
        code={code}
        picker={
          editable ? (
            <LanguagePicker
              code={code}
              language={language}
              onChange={(next) => {
                updateAttributes({ language: next });
              }}
            />
          ) : null
        }
      >
        <NodeViewContent<"code">
          as="code"
          className="min-w-0 flex-1 whitespace-pre in-data-wrap:break-words in-data-wrap:whitespace-pre-wrap"
        />
      </CodeFrame>
    </NodeViewWrapper>
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
