import { XIcon } from "lucide-react";

import { useOpenPalette } from "~/components/command-palette";
import { Button } from "~/components/ui/button";
import { clearSelection, useSelection } from "~/lib/issue-selection";
import { hotkeyCaps, isMac } from "~/lib/use-hotkey";

export const SelectionBar = () => {
  const count = useSelection().ids.size;
  const openPalette = useOpenPalette();

  if (count === 0) {
    return null;
  }

  return (
    <div
      aria-label="Selected issues"
      className="bg-surface-2 shadow-menu absolute bottom-4 left-1/2 z-20 flex h-11 -translate-x-1/2 items-center gap-2 rounded-full p-2 pl-5"
      role="toolbar"
    >
      <span aria-live="polite" className="mr-1 text-xs whitespace-nowrap">
        {count} selected
      </span>
      {openPalette === null ? null : (
        <Button
          aria-keyshortcuts="Meta+K"
          onClick={openPalette}
          size="pill"
          variant="outline"
        >
          <span aria-hidden className="text-muted-foreground max-md:hidden">
            {hotkeyCaps({ keys: "k", mod: true }, isMac()).join(" ")}
          </span>
          Actions
        </Button>
      )}
      <Button
        aria-keyshortcuts="Escape"
        aria-label="Clear selection"
        onClick={clearSelection}
        size="icon-round"
        variant="ghost"
      >
        <XIcon />
      </Button>
    </div>
  );
};
