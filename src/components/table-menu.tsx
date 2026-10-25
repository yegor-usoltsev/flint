import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import type { EditorState, Selection, Transaction } from "@tiptap/pm/state";
import {
  CellSelection,
  cellAround,
  deleteCellSelection,
  isInTable,
  moveTableColumn,
  moveTableRow,
  selectedRect,
} from "@tiptap/pm/tables";
import type { EditorView } from "@tiptap/pm/view";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  BetweenHorizontalEndIcon,
  BetweenHorizontalStartIcon,
  BetweenVerticalEndIcon,
  BetweenVerticalStartIcon,
  BoldIcon,
  CopyIcon,
  ItalicIcon,
  StrikethroughIcon,
  Trash2Icon,
  TypeIcon,
} from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "~/components/ui/dropdown-menu";
import { copyText } from "~/lib/copy";
import { keyLabel } from "~/lib/editor-keys";

type Command = (
  state: EditorState,
  dispatch?: (tr: Transaction) => void
) => boolean;

const moves = {
  down: { axis: "row", step: 1 },
  left: { axis: "column", step: -1 },
  right: { axis: "column", step: 1 },
  up: { axis: "row", step: -1 },
} as const;

type Direction = keyof typeof moves;

// The first row is the Markdown header, so body rows move only among themselves.
const move =
  (direction: Direction): Command =>
  (state, dispatch) => {
    if (!isInTable(state)) {
      return false;
    }

    const { axis, step } = moves[direction];
    const { left, map, top } = selectedRect(state);
    const from = axis === "row" ? top : left;
    const to = from + step;
    const limit = axis === "row" ? map.height : map.width;
    const first = axis === "row" ? 1 : 0;

    if (from < first || to < first || to >= limit) {
      return false;
    }

    return (axis === "row" ? moveTableRow : moveTableColumn)({ from, to })(
      state,
      dispatch
    );
  };

const moveKeys = {
  down: "Mod-Alt-Shift-ArrowDown",
  left: "Mod-Alt-Shift-ArrowLeft",
  right: "Mod-Alt-Shift-ArrowRight",
  up: "Mod-Alt-Shift-ArrowUp",
} as const;

export const TableKeys = Extension.create({
  addKeyboardShortcuts() {
    const shortcut = (direction: Direction) => () =>
      this.editor.commands.command(({ dispatch, state }) =>
        move(direction)(state, dispatch)
      );

    return {
      [moveKeys.down]: shortcut("down"),
      [moveKeys.left]: shortcut("left"),
      [moveKeys.right]: shortcut("right"),
      [moveKeys.up]: shortcut("up"),
    };
  },
  name: "tableKeys",
});

const Item = ({
  children,
  icon,
  keys,
  onClick,
}: {
  children: ReactNode;
  icon: ReactNode;
  keys?: string;
  onClick: () => void;
}) => (
  <DropdownMenuItem onClick={onClick}>
    {icon}
    {children}
    {keys === undefined ? null : (
      <DropdownMenuShortcut>{keyLabel(keys)}</DropdownMenuShortcut>
    )}
  </DropdownMenuItem>
);

const moveItems = [
  { direction: "up", icon: <ArrowUpIcon />, label: "Move row up" },
  { direction: "down", icon: <ArrowDownIcon />, label: "Move row down" },
  { direction: "left", icon: <ArrowLeftIcon />, label: "Move column left" },
  { direction: "right", icon: <ArrowRightIcon />, label: "Move column right" },
] as const;

const TableMenuItems = ({ editor }: { editor: Editor }) => {
  const { selection } = editor.state;

  const run = (command: Command) => {
    command(editor.state, editor.view.dispatch);
    editor.commands.focus();
  };

  const chain = () => editor.chain().focus();

  const several =
    selection instanceof CellSelection &&
    selection.$anchorCell.pos !== selection.$headCell.pos;

  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <TypeIcon />
          Format
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-40">
          <Item
            icon={<BoldIcon />}
            onClick={() => {
              chain().toggleBold().run();
            }}
          >
            Bold
          </Item>
          <Item
            icon={<ItalicIcon />}
            onClick={() => {
              chain().toggleItalic().run();
            }}
          >
            Italic
          </Item>
          <Item
            icon={<StrikethroughIcon />}
            onClick={() => {
              chain().toggleStrike().run();
            }}
          >
            Strikethrough
          </Item>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      {several ? (
        <Item
          icon={<CopyIcon />}
          onClick={() => {
            const { content } = selection.content();

            void copyText(content.textBetween(0, content.size, "\n"), "text");
          }}
        >
          Copy text
        </Item>
      ) : null}
      <DropdownMenuSeparator />
      <Item
        icon={<BetweenHorizontalStartIcon />}
        onClick={() => {
          chain().addRowBefore().run();
        }}
      >
        Insert row above
      </Item>
      <Item
        icon={<BetweenHorizontalEndIcon />}
        onClick={() => {
          chain().addRowAfter().run();
        }}
      >
        Insert row below
      </Item>
      <DropdownMenuSeparator />
      <Item
        icon={<BetweenVerticalStartIcon />}
        onClick={() => {
          chain().addColumnBefore().run();
        }}
      >
        Insert column before
      </Item>
      <Item
        icon={<BetweenVerticalEndIcon />}
        onClick={() => {
          chain().addColumnAfter().run();
        }}
      >
        Insert column after
      </Item>
      <DropdownMenuSeparator />
      {moveItems.map(({ direction, icon, label }) =>
        move(direction)(editor.state) ? (
          <Item
            icon={icon}
            key={direction}
            keys={moveKeys[direction]}
            onClick={() => {
              run(move(direction));
            }}
          >
            {label}
          </Item>
        ) : null
      )}
      <Item
        icon={<Trash2Icon />}
        onClick={() => {
          const { bottom, left, map, right, top } = selectedRect(editor.state);
          const rows = left === 0 && right === map.width;
          const columns = top === 0 && bottom === map.height;

          if (rows && columns) {
            chain().deleteTable().run();
          } else if (rows) {
            chain().deleteRow().run();
          } else if (columns) {
            chain().deleteColumn().run();
          } else {
            run(deleteCellSelection);
          }
        }}
      >
        Delete
      </Item>
    </>
  );
};

// Shift+F10 and the context menu key target the focused editor root rather than a cell, so the menu opens at the selected cell.
const fromKeyboard = (event: MouseEvent) =>
  event.button !== 2 &&
  !event.ctrlKey &&
  !(
    event.nativeEvent instanceof PointerEvent &&
    event.nativeEvent.pointerType !== ""
  );

const selectedCell = (selection: Selection) =>
  selection instanceof CellSelection
    ? selection.$headCell
    : cellAround(selection.$head);

const pointedCell = (view: EditorView, event: MouseEvent) => {
  const cell =
    event.target instanceof Element ? event.target.closest("td, th") : null;

  const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });

  return cell === null || !view.dom.contains(cell) || hit === null
    ? null
    : cellAround(view.state.doc.resolve(hit.pos));
};

export const useTableMenu = (editor: Editor) => {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);

  const handleContextMenu = (event: MouseEvent) => {
    const { view } = editor;
    const { selection } = view.state;

    if (!editor.isEditable) {
      return;
    }

    const $cell = fromKeyboard(event)
      ? selectedCell(selection)
      : pointedCell(view, event);

    const element = $cell === null ? null : view.nodeDOM($cell.pos);

    if ($cell === null || !(element instanceof Element)) {
      return;
    }

    event.preventDefault();

    const inside =
      selection instanceof CellSelection &&
      selection.ranges.some(
        ({ $from, $to }) => $from.pos <= $cell.pos + 1 && $to.pos >= $cell.pos
      );

    if (!inside) {
      view.dispatch(view.state.tr.setSelection(new CellSelection($cell)));
    }

    view.focus();

    const rect = element.getBoundingClientRect();

    setPoint(
      fromKeyboard(event)
        ? { x: rect.left, y: rect.bottom }
        : { x: event.clientX, y: event.clientY }
    );
  };

  const anchor =
    point === null
      ? null
      : {
          getBoundingClientRect: () =>
            DOMRect.fromRect({ height: 0, width: 0, ...point }),
        };

  return {
    menu: (
      <DropdownMenu
        onOpenChange={(open) => {
          if (!open) {
            setPoint(null);
          }
        }}
        open={point !== null}
      >
        <DropdownMenuContent
          anchor={anchor}
          className="w-auto min-w-56 whitespace-nowrap"
        >
          {point === null ? null : <TableMenuItems editor={editor} />}
        </DropdownMenuContent>
      </DropdownMenu>
    ),
    handleContextMenu,
  };
};
