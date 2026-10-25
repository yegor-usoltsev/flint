import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/$slug/settings/")({
  beforeLoad: ({ params }) => {
    // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router redirects by throwing.
    throw redirect({
      params,
      replace: true,
      to: "/$slug/settings/account/preferences",
    });
  },
});
