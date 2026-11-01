import { PaperclipIcon } from "lucide-react";
import { useRef } from "react";
import type { ComponentProps } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";

const AttachTrigger = (props: ComponentProps<"button">) => (
  <button
    {...props}
    className="text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:ring-ring hit-area relative flex size-8 items-center justify-center rounded-md outline-none focus-visible:ring-2 md:size-6 [&_svg]:size-3.5"
    type="button"
  />
);

export const AttachButton = ({
  onFiles,
}: {
  onFiles: (files: File[]) => void;
}) => {
  const input = useRef<HTMLInputElement>(null);

  return (
    <>
      <input
        className="hidden"
        multiple
        onChange={(event) => {
          onFiles([...(event.target.files ?? [])]);
          event.target.value = "";
        }}
        ref={input}
        type="file"
      />
      <Tooltip>
        <TooltipTrigger
          render={
            <AttachTrigger
              aria-label="Attach files"
              onClick={() => {
                input.current?.click();
              }}
            />
          }
        >
          <PaperclipIcon />
        </TooltipTrigger>
        <TooltipContent>Attach files</TooltipContent>
      </Tooltip>
    </>
  );
};
