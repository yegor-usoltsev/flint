import { Link, useRouter } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { cn } from "cn";
import { RotateCwIcon, TriangleAlertIcon } from "lucide-react";

import { Button, buttonVariants } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";

export const RouteError = ({ reset }: ErrorComponentProps) => {
  const router = useRouter();

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <TriangleAlertIcon />
        </EmptyMedia>
        <EmptyTitle>
          <h1>This page failed to load</h1>
        </EmptyTitle>
        <EmptyDescription>
          Something went wrong on the server. Try again, or go back home.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center">
        <Button
          onClick={() => {
            reset();
            void router.invalidate();
          }}
        >
          <RotateCwIcon data-icon="inline-start" />
          Try again
        </Button>
        <Link className={cn(buttonVariants({ variant: "outline" }))} to="/">
          Home
        </Link>
      </EmptyContent>
    </Empty>
  );
};
