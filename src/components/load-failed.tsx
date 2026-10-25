import { cn } from "cn";
import { TriangleAlertIcon } from "lucide-react";

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { ApiError } from "~/lib/api";

export const LoadFailed = ({
  className,
  error,
  onRetry,
  title,
}: {
  className?: string;
  error: Error;
  onRetry: () => void;
  title: string;
}) => (
  <Alert className={cn("w-auto", className)} variant="destructive">
    <TriangleAlertIcon />
    <AlertTitle>
      <h2>{title}</h2>
    </AlertTitle>
    <AlertDescription>
      {error instanceof ApiError
        ? error.message
        : "Check your connection and try again."}
    </AlertDescription>
    <AlertAction>
      <Button onClick={onRetry} size="sm" variant="outline">
        Retry
      </Button>
    </AlertAction>
  </Alert>
);

export const RefreshFailed = ({
  failed,
  onRetry,
  what,
}: {
  failed: boolean;
  onRetry: () => void;
  what: string;
}) => {
  if (!failed) {
    return null;
  }

  return (
    <output className="text-destructive flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-xs md:px-4">
      Could not refresh {what}; showing the last loaded version.
      <button
        className="hit-area relative font-medium underline-offset-2 hover:underline"
        onClick={onRetry}
        type="button"
      >
        Retry
      </button>
    </output>
  );
};
