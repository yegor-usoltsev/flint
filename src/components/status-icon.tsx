import { cn } from "cn";
import { useId } from "react";

import type { StatusCategory } from "~/lib/api-types";
import type { Color } from "~/lib/colors";

const Ring = ({ dashed = false }: { dashed?: boolean }) => (
  <circle
    cx="7"
    cy="7"
    fill="none"
    r="5.75"
    stroke="currentColor"
    strokeDasharray={dashed ? "1.5 1.51" : undefined}
    strokeWidth="1.5"
  />
);

const Cutout = ({ path }: { path: string }) => {
  const id = useId();

  return (
    <>
      <mask id={id}>
        {/* oxlint-disable-next-line shadcn/no-raw-colors -- Mask luminance needs literal white. */}
        <rect fill="white" height="14" width="14" />
        <path
          d={path}
          fill="none"
          // oxlint-disable-next-line shadcn/no-raw-colors -- Mask luminance needs literal black.
          stroke="black"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
        />
      </mask>
      <circle cx="7" cy="7" fill="currentColor" mask={`url(#${id})`} r="6.5" />
    </>
  );
};

const glyphs = {
  backlog: <Ring dashed />,
  canceled: <Cutout path="M5 5l4 4M9 5l-4 4" />,
  completed: <Cutout path="M4.5 7.2l1.8 1.8 3.4-3.6" />,
  started: (
    <>
      <Ring />
      <path d="M7 3.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" />
    </>
  ),
  unstarted: <Ring />,
} as const;

export const StatusIcon = ({
  category,
  className,
  color,
}: {
  category: StatusCategory;
  className?: string;
  color: Color;
}) => (
  <svg
    aria-hidden
    className={cn("text-swatch size-3.5 shrink-0", className)}
    data-color={color}
    viewBox="0 0 14 14"
  >
    {glyphs[category]}
  </svg>
);
