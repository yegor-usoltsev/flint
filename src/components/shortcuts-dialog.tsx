import { DeleteIcon } from "lucide-react";
import { Fragment } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Kbd, KbdGroup } from "~/components/ui/kbd";
import { hotkeyCaps, isMac } from "~/lib/use-hotkey";
import type { Hotkey } from "~/lib/use-hotkey";

export const KeyCap = ({ cap }: { cap: string }) => (
  <span className="flex items-center">
    {cap === "⌫" ? (
      <DeleteIcon aria-label="Backspace" className="size-3" />
    ) : (
      cap
    )}
  </span>
);

export const Keys = ({
  className,
  hotkey,
}: {
  className?: string;
  hotkey: Hotkey;
}) => (
  <KbdGroup className={className}>
    {hotkeyCaps(hotkey, isMac()).map((cap) => (
      <Kbd key={cap}>
        <KeyCap cap={cap} />
      </Kbd>
    ))}
  </KbdGroup>
);

export const SubmitHint = () => (
  <kbd className="text-primary-foreground ml-1 font-sans text-xs font-normal max-md:hidden">
    {hotkeyCaps({ keys: "enter", mod: true }, isMac()).join("")}
  </kbd>
);

interface Row {
  hotkeys: Hotkey[];
  label: string;
}

const sections: { rows: Row[]; title: string }[] = [
  {
    rows: [
      { hotkeys: [{ keys: "k", mod: true }], label: "Command menu" },
      { hotkeys: [{ keys: "/" }], label: "Search" },
      { hotkeys: [{ keys: "c" }], label: "Create issue" },
      { hotkeys: [{ keys: "[" }], label: "Toggle sidebar" },
      { hotkeys: [{ keys: "?" }], label: "Keyboard shortcuts" },
      {
        hotkeys: [{ keys: "escape" }],
        label: "Close, clear the selection or focus, or go back",
      },
    ],
    title: "General",
  },
  {
    rows: [
      { hotkeys: [{ keys: "g m" }], label: "My issues" },
      { hotkeys: [{ keys: "g p" }], label: "Projects" },
      { hotkeys: [{ keys: "g l" }], label: "Project list" },
      { hotkeys: [{ keys: "g b" }], label: "Project board" },
      { hotkeys: [{ keys: "g w" }], label: "Wiki" },
      { hotkeys: [{ keys: "g s" }], label: "Settings" },
      { hotkeys: [{ keys: "g t" }], label: "Trash" },
    ],
    title: "Go to",
  },
  {
    rows: [
      {
        hotkeys: [{ keys: "j" }, { keys: "k" }],
        label: "Next or previous issue",
      },
      {
        hotkeys: [{ keys: "arrowleft" }, { keys: "arrowright" }],
        label: "Previous or next column on the board",
      },
      { hotkeys: [{ keys: "enter" }], label: "Open issue" },
      { hotkeys: [{ keys: "f" }], label: "Filter" },
      { hotkeys: [{ keys: "b", mod: true }], label: "Toggle list and board" },
    ],
    title: "Lists and boards",
  },
  {
    rows: [
      { hotkeys: [{ keys: "x" }], label: "Select or deselect the issue" },
      {
        hotkeys: [
          { keys: "arrowdown", shift: true },
          { keys: "arrowup", shift: true },
        ],
        label: "Extend the selection",
      },
      { hotkeys: [{ keys: "a", mod: true }], label: "Select all issues" },
    ],
    title: "Selection",
  },
  {
    rows: [
      { hotkeys: [{ keys: "s" }], label: "Change status" },
      { hotkeys: [{ keys: "p" }], label: "Change priority" },
      { hotkeys: [{ keys: "a" }], label: "Assign to…" },
      { hotkeys: [{ keys: "i" }], label: "Assign to me" },
      { hotkeys: [{ keys: "l" }], label: "Change labels" },
      { hotkeys: [{ keys: "m" }], label: "Comment" },
      { hotkeys: [{ keys: "0–9" }], label: "Pick an option in a menu" },
      { hotkeys: [{ keys: ".", mod: true }], label: "Copy issue ID" },
      {
        hotkeys: [{ keys: ",", mod: true, shift: true }],
        label: "Copy issue URL",
      },
      {
        hotkeys: [{ keys: ".", mod: true, shift: true }],
        label: "Copy git branch name",
      },
      { hotkeys: [{ keys: "backspace", mod: true }], label: "Delete issue" },
    ],
    title: "Focused or selected issues",
  },
  {
    rows: [
      { hotkeys: [{ keys: "s", mod: true }], label: "Save page" },
      { hotkeys: [{ keys: "r", shift: true }], label: "Rename page" },
      { hotkeys: [{ keys: "p", shift: true }], label: "Move page" },
      {
        hotkeys: [{ keys: ",", mod: true, shift: true }],
        label: "Copy page link",
      },
      {
        hotkeys: [{ keys: "'", mod: true, shift: true }],
        label: "Copy page title",
      },
      { hotkeys: [{ keys: "backspace", mod: true }], label: "Delete page" },
    ],
    title: "Wiki pages",
  },
];

export const ShortcutsDialog = ({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) => (
  <Dialog onOpenChange={onOpenChange} open={open}>
    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>Keyboard shortcuts</DialogTitle>
        <DialogDescription>
          Single keys work when focus is outside a text field. Press G, then a
          letter, to go somewhere.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
        {sections.map((section) => (
          <section key={section.title}>
            <h3 className="text-muted-foreground mb-1.5 text-xs font-medium">
              {section.title}
            </h3>
            <dl>
              {section.rows.map((row) => (
                <div
                  className="border-border/60 flex h-8 items-center justify-between gap-4 border-b last:border-b-0"
                  key={row.label}
                >
                  <dt className="truncate">{row.label}</dt>
                  <dd className="flex shrink-0 items-center gap-1">
                    {row.hotkeys.map((hotkey, index) => (
                      <Fragment key={hotkey.keys}>
                        {index > 0 ? (
                          <span className="text-muted-foreground text-xs">
                            /
                          </span>
                        ) : null}
                        <Keys hotkey={hotkey} />
                      </Fragment>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </DialogContent>
  </Dialog>
);
