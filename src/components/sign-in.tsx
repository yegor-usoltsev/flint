import { cn } from "cn";
import { TriangleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { buttonVariants } from "~/components/ui/button";

export const FlintMark = ({ className }: { className?: string }) => (
  <img
    alt=""
    className={cn("size-10.5", className)}
    height={42}
    src="/favicon.svg"
    width={42}
  />
);

export const CenteredCard = ({ children }: { children: ReactNode }) => (
  <div className="m-auto flex w-full max-w-72 flex-col items-center gap-6 py-16 text-center">
    {children}
  </div>
);

export const SignIn = ({
  failed = false,
  returnTo,
}: {
  failed?: boolean;
  returnTo?: string;
}) => (
  <CenteredCard>
    <FlintMark />
    <div className="flex flex-col gap-2">
      <h1 className="text-lg font-medium">Log in to Flint</h1>
      <p className="text-muted-foreground">
        Issues and docs for teams on Gitea.
      </p>
    </div>
    {failed ? (
      <Alert className="text-left" variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>Sign-in failed</AlertTitle>
        <AlertDescription>
          Gitea did not confirm the sign-in. Try again.
        </AlertDescription>
      </Alert>
    ) : null}
    <a
      className={cn(buttonVariants({ size: "cta" }), "w-full")}
      href={
        returnTo === undefined
          ? "/api/auth/login"
          : `/api/auth/login?${new URLSearchParams({ returnTo }).toString()}`
      }
    >
      Continue with Gitea
    </a>
  </CenteredCard>
);
