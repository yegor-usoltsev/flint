import { cn } from "cn";
import { useState } from "react";

import { ColorSwatches } from "~/components/color-picker";
import { ProjectIcon } from "~/components/project-icon";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { colorLabel } from "~/lib/colors";
import type { Color } from "~/lib/colors";
import { projectIcons } from "~/lib/project-icons";
import type { ProjectIcon as IconName } from "~/lib/project-icons";

const iconLabel = (icon: IconName) => {
  const words = icon.replaceAll("-", " ");

  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
};

export const IconPicker = ({
  color,
  disabled = false,
  icon,
  label,
  onChange,
}: {
  color: Color;
  disabled?: boolean;
  icon: IconName;
  label: string;
  onChange: (change: { color?: Color; icon?: IconName }) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const words = query.trim().toLowerCase();

  const shown = projectIcons.filter((name) =>
    iconLabel(name).toLowerCase().includes(words)
  );

  return (
    <Popover
      onOpenChange={(next) => {
        setOpen(next);
        setQuery("");
      }}
      open={open}
    >
      <PopoverTrigger
        disabled={disabled}
        render={
          <Button
            aria-label={`${label}: ${iconLabel(icon)}, ${colorLabel(color)}`}
            size="icon"
            variant="outline"
          />
        }
      >
        <ProjectIcon color={color} icon={icon} />
      </PopoverTrigger>
      <PopoverContent align="start" aria-label={label} className="w-auto">
        <ColorSwatches
          label="Color"
          onChange={(next) => {
            onChange({ color: next });
          }}
          value={color}
        />
        <Input
          aria-label="Search icons"
          autoComplete="off"
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder="Search icons…"
          value={query}
        />
        <fieldset aria-label="Icon" className="grid grid-cols-12 gap-0.5">
          {shown.map((name) => (
            <button
              aria-label={iconLabel(name)}
              aria-pressed={name === icon}
              className={cn(
                "hover:bg-accent focus-visible:ring-ring/50 flex size-7 items-center justify-center rounded-md outline-none focus-visible:ring-2",
                name === icon && "bg-accent"
              )}
              key={name}
              onClick={() => {
                onChange({ icon: name });
                setOpen(false);
              }}
              type="button"
            >
              <ProjectIcon color={color} icon={name} />
            </button>
          ))}
        </fieldset>
        {shown.length === 0 ? (
          <p className="text-muted-foreground px-1">No icons match</p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
};
