import { cn } from "cn";
import { useId } from "react";

import type { Priority } from "~/lib/priorities";

const bars = [
  { height: 4, x: 1.5 },
  { height: 7, x: 5.5 },
  { height: 10, x: 9.5 },
] as const;

const Urgent = () => {
  const id = useId();

  return (
    <>
      <mask id={id}>
        {/* oxlint-disable-next-line shadcn/no-raw-colors -- Mask luminance needs literal white. */}
        <rect fill="white" height="14" width="14" />
        <path
          d="M7 3.75v4M7 10.25v.01"
          // oxlint-disable-next-line shadcn/no-raw-colors -- Mask luminance needs literal black.
          stroke="black"
          strokeLinecap="round"
          strokeWidth="1.6"
        />
      </mask>
      <rect
        className="fill-priority-urgent"
        height="13"
        mask={`url(#${id})`}
        rx="3"
        width="13"
        x="0.5"
        y="0.5"
      />
    </>
  );
};

export const PriorityIcon = ({
  className,
  priority,
}: {
  className?: string;
  priority: Priority;
}) => (
  <svg
    aria-hidden
    className={cn("text-muted-foreground size-3.5 shrink-0", className)}
    fill="currentColor"
    viewBox="0 0 14 14"
  >
    {priority === 1 ? <Urgent /> : null}
    {priority === 0
      ? bars.map(({ x }) => (
          <rect
            height="1.5"
            key={x}
            opacity="0.6"
            rx="0.75"
            width="3"
            x={x}
            y="6.25"
          />
        ))
      : null}
    {priority > 1
      ? bars.map(({ height, x }, index) => (
          <rect
            height={height}
            key={x}
            opacity={index < 5 - priority ? 1 : 0.3}
            rx="1"
            width="3"
            x={x}
            y={12 - height}
          />
        ))
      : null}
  </svg>
);
