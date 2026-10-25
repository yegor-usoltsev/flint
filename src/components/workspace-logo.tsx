import { cn } from "cn";

import type { Workspace } from "~/lib/api-types";

export const WorkspaceLogo = ({
  className,
  workspace,
}: {
  className?: string;
  workspace: Pick<Workspace, "color" | "logoUrl" | "name">;
}) => {
  if (workspace.logoUrl !== null) {
    return (
      <img
        alt=""
        className={cn(
          "bg-muted outline-foreground/15 size-5 shrink-0 rounded-md object-cover outline -outline-offset-1",
          className
        )}
        src={workspace.logoUrl}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        "bg-swatch text-2xs dark:text-background flex size-5 shrink-0 items-center justify-center rounded-md font-semibold text-white",
        className
      )}
      data-color={workspace.color}
    >
      {workspace.name.charAt(0).toUpperCase()}
    </span>
  );
};
