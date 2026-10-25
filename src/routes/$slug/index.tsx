import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/$slug/")({
  beforeLoad: ({ params }) => {
    // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router redirects by throwing.
    throw redirect({ params, replace: true, to: "/$slug/my-issues" });
  },
});
