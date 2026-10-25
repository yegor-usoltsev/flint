import { Menu } from "@base-ui/react/menu";

import { KeyCap } from "~/components/shortcuts-dialog";
import {
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "~/components/ui/dropdown-menu";
import { hotkeyCaps, isCoarsePointer, isMac } from "~/lib/use-hotkey";
import type { Hotkey } from "~/lib/use-hotkey";

const inputClass =
  "placeholder:text-muted-foreground h-8 w-full bg-transparent px-2 text-base outline-none md:text-sm";

export const MenuKeys = ({ hotkey }: { hotkey: Hotkey }) => (
  <DropdownMenuShortcut className="max-md:hidden">
    {hotkeyCaps(hotkey, isMac()).map((cap) => (
      <KeyCap cap={cap} key={cap} />
    ))}
  </DropdownMenuShortcut>
);

export const MenuFilterInput = (props: Menu.Input.Props) => (
  <>
    <Menu.Input
      className={inputClass}
      inputMode={isCoarsePointer() ? "none" : undefined}
      {...props}
    />
    <DropdownMenuSeparator />
  </>
);

export const RootMenuFilter = ({ query }: { query: string }) => (
  <>
    <Menu.Input
      aria-label="Filter actions"
      className={query === "" ? "sr-only" : inputClass}
      inputMode={isCoarsePointer() ? "none" : undefined}
      placeholder="Filter…"
    />
    {query === "" ? null : <DropdownMenuSeparator />}
  </>
);
