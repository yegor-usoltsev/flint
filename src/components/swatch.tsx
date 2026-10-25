import { cn } from "cn";

import type { Color } from "~/lib/colors";

export const Swatch = ({
  className,
  color,
}: {
  className?: string;
  color: Color;
}) => (
  <span
    aria-hidden
    className={cn("bg-swatch size-2.5 shrink-0 rounded-full", className)}
    data-color={color}
  />
);
