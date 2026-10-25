import { CheckIcon } from "lucide-react";

import { Swatch } from "~/components/swatch";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { colorLabel, colors, isColor } from "~/lib/colors";
import type { Color } from "~/lib/colors";

export const ColorPicker = ({
  disabled = false,
  label,
  onChange,
  value,
}: {
  disabled?: boolean;
  label: string;
  onChange: (color: Color) => void;
  value: Color;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger
      disabled={disabled}
      render={
        <Button
          aria-label={`${label}: ${colorLabel(value)}`}
          size="icon"
          variant="outline"
        />
      }
    >
      <Swatch className="size-3" color={value} />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="w-36">
      <DropdownMenuRadioGroup
        onValueChange={(color) => {
          if (isColor(color)) {
            onChange(color);
          }
        }}
        value={value}
      >
        {colors.map((color) => (
          <DropdownMenuRadioItem key={color} value={color}>
            <Swatch color={color} />
            {colorLabel(color)}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
);

export const ColorSwatches = ({
  disabled = false,
  label,
  onChange,
  value,
}: {
  disabled?: boolean;
  label: string;
  onChange: (color: Color) => void;
  value: Color;
}) => (
  <fieldset
    aria-label={label}
    className="grid w-fit grid-cols-6 gap-1.5 sm:grid-cols-12"
  >
    {colors.map((color) => (
      <button
        aria-label={colorLabel(color)}
        aria-pressed={color === value}
        className="bg-swatch hit-area focus-visible:ring-ring/50 relative flex size-5.5 items-center justify-center rounded-full text-white outline-none focus-visible:ring-3 disabled:opacity-50"
        data-color={color}
        disabled={disabled}
        key={color}
        onClick={() => {
          onChange(color);
        }}
        type="button"
      >
        {color === value ? <CheckIcon aria-hidden className="size-3" /> : null}
      </button>
    ))}
  </fieldset>
);
