import { Extension } from "@tiptap/core";
import type { ChainedCommands } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { Suggestion } from "@tiptap/suggestion";
import type { SuggestionOptions } from "@tiptap/suggestion";
import {
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ImageIcon,
  ListIcon,
  ListOrderedIcon,
  ListTodoIcon,
  MinusIcon,
  PaperclipIcon,
  QuoteIcon,
  SquareCodeIcon,
  TableIcon,
  WorkflowIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import {
  SuggestionList,
  useSuggestionMenu,
} from "~/components/suggestion-menu";
import { keyLabel } from "~/lib/editor-keys";
import { allowedPrefixes, allowTrigger } from "~/lib/suggestion-trigger";

interface SlashItem {
  group: number;
  icon: ReactNode;
  keys?: string;
  keywords: string;
  run?: (chain: ChainedCommands) => ChainedCommands;
  title: string;
  upload?: string;
}

const mediaTypes = "image/*,video/*,audio/*";

// The slash menu's groups, names and shortcuts, with Table and Divider listed too.
const slashItems: SlashItem[] = [
  {
    group: 0,
    icon: <Heading1Icon />,
    keys: "Mod-Alt-1",
    keywords: "h1 title",
    run: (chain) => chain.setHeading({ level: 1 }),
    title: "Heading 1",
  },
  {
    group: 0,
    icon: <Heading2Icon />,
    keys: "Mod-Alt-2",
    keywords: "h2 subtitle",
    run: (chain) => chain.setHeading({ level: 2 }),
    title: "Heading 2",
  },
  {
    group: 0,
    icon: <Heading3Icon />,
    keys: "Mod-Alt-3",
    keywords: "h3",
    run: (chain) => chain.setHeading({ level: 3 }),
    title: "Heading 3",
  },
  {
    group: 1,
    icon: <ListIcon />,
    keys: "Mod-Shift-8",
    keywords: "unordered ul",
    run: (chain) => chain.toggleBulletList(),
    title: "Bulleted list",
  },
  {
    group: 1,
    icon: <ListOrderedIcon />,
    keys: "Mod-Shift-9",
    keywords: "ordered ol",
    run: (chain) => chain.toggleOrderedList(),
    title: "Numbered list",
  },
  {
    group: 1,
    icon: <ListTodoIcon />,
    keys: "Mod-Shift-7",
    keywords: "todo task checkbox",
    run: (chain) => chain.toggleTaskList(),
    title: "Checklist",
  },
  {
    group: 2,
    icon: <ImageIcon />,
    keywords: "image video audio picture",
    title: "Insert media…",
    upload: mediaTypes,
  },
  {
    group: 2,
    icon: <PaperclipIcon />,
    keys: "Mod-Shift-u",
    keywords: "upload file attachment",
    title: "Attach files…",
    upload: "",
  },
  {
    group: 3,
    icon: <SquareCodeIcon />,
    keys: "Mod-Shift-\\",
    keywords: "snippet pre",
    run: (chain) => chain.setCodeBlock(),
    title: "Code block",
  },
  {
    group: 3,
    icon: <WorkflowIcon />,
    keywords: "mermaid chart flowchart",
    run: (chain) => chain.setCodeBlock({ language: "mermaid" }),
    title: "Diagram",
  },
  {
    group: 3,
    icon: <QuoteIcon />,
    keys: "Alt-Shift-.",
    keywords: "quote citation",
    run: (chain) => chain.toggleBlockquote(),
    title: "Blockquote",
  },
  {
    group: 4,
    icon: <TableIcon />,
    keywords: "grid",
    run: (chain) =>
      chain.insertTable({ cols: 2, rows: 3, withHeaderRow: true }),
    title: "Table",
  },
  {
    group: 4,
    icon: <MinusIcon />,
    keys: "Mod-Shift--",
    keywords: "horizontal rule hr separator",
    run: (chain) => chain.setHorizontalRule(),
    title: "Divider",
  },
];

const matches = (text: string, needle: string) =>
  text
    .toLowerCase()
    .split(/[\s.…]+/u)
    .some((word) => word.startsWith(needle));

const filterSlashItems = (query: string, uploads: boolean) => {
  const needle = query.toLowerCase();

  const allowed = slashItems.filter(
    (item) => uploads || item.upload === undefined
  );

  if (needle === "") {
    return allowed;
  }

  return [
    ...allowed.filter((item) => matches(item.title, needle)),
    ...allowed.filter(
      (item) => !matches(item.title, needle) && matches(item.keywords, needle)
    ),
  ];
};

const SlashCommands = Extension.create<{
  pick: (accept: string) => boolean;
  render?: SuggestionOptions<SlashItem, SlashItem>["render"];
  uploads: () => boolean;
}>({
  addOptions: () => ({ pick: () => false, uploads: () => false }),
  addProseMirrorPlugins() {
    const { pick, uploads } = this.options;

    return [
      Suggestion<SlashItem, SlashItem>({
        allow: allowTrigger,
        allowedPrefixes,
        char: "/",
        command: ({ editor, props, range }) => {
          const chain = editor.chain().focus().deleteRange(range);

          (props.run?.(chain) ?? chain).run();

          if (props.upload !== undefined) {
            pick(props.upload);
          }
        },
        container: "[data-slot=dialog-content]",
        editor: this.editor,
        items: ({ query }) => filterSlashItems(query, uploads()),
        pluginKey: new PluginKey("slash"),
        render: this.options.render,
      }),
    ];
  },
  name: "slashCommands",
});

// Block shortcuts where they differ from Tiptap's defaults (which swap the numbered list and checklist keys).
export const BlockKeys = Extension.create<{
  pick: (accept: string) => boolean;
}>({
  addKeyboardShortcuts() {
    const { pick } = this.options;

    return {
      "Alt-Shift-.": () => this.editor.commands.toggleBlockquote(),
      "Mod-Shift--": () => this.editor.commands.setHorizontalRule(),
      "Mod-Shift-7": () => this.editor.commands.toggleTaskList(),
      "Mod-Shift-9": () => this.editor.commands.toggleOrderedList(),
      "Mod-Shift-\\": () => this.editor.commands.toggleCodeBlock(),
      "Mod-Shift-u": () => pick(""),
    };
  },
  addOptions: () => ({ pick: () => false }),
  name: "blockKeys",
  priority: 1000,
});

export const useSlashMenu = ({
  pick,
  uploads,
}: {
  pick: (accept: string) => boolean;
  uploads: () => boolean;
}) => {
  const { isOpen, menu, render, selected } = useSuggestionMenu<SlashItem>();

  return {
    extension: SlashCommands.configure({ pick, render, uploads }),
    isOpen,
    menu:
      menu === null ? null : (
        <SuggestionList
          className="w-56"
          groupOf={(item) => String(item.group)}
          keyOf={(item) => item.title}
          label="Blocks"
          menu={menu}
          selected={selected}
        >
          {(item) => (
            <>
              {item.icon}
              <span className="flex-1 truncate">{item.title}</span>
              {item.keys === undefined ? null : (
                <span className="text-muted-foreground text-xs">
                  {keyLabel(item.keys)}
                </span>
              )}
            </>
          )}
        </SuggestionList>
      ),
  };
};
