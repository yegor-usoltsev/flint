import { useQueryClient } from "@tanstack/react-query";
import { PanelRightCloseIcon, PanelRightOpenIcon } from "lucide-react";

import { Keys } from "~/components/shortcuts-dialog";
import { Button } from "~/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { panelVisible, togglePanel, usePanel } from "~/lib/issue-panel";

export const PanelToggle = () => {
  const queryClient = useQueryClient();
  const state = usePanel();
  const open = panelVisible(state);

  if (!state.available || (state.scope === "wiki" && state.issue === null)) {
    return null;
  }

  const label = open ? "Close issue panel" : "Open issue panel";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-keyshortcuts="]"
            aria-label={label}
            aria-pressed={open}
            onClick={() => {
              togglePanel(queryClient);
            }}
            size="icon-sm"
            variant="ghost"
          />
        }
      >
        {open ? <PanelRightCloseIcon /> : <PanelRightOpenIcon />}
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label}
        <Keys hotkey={{ keys: "]" }} />
      </TooltipContent>
    </Tooltip>
  );
};
