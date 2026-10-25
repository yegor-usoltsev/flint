import { createFileRoute, Outlet } from "@tanstack/react-router";

const SiteLayout = () => (
  <main className="flex min-h-dvh flex-col p-4" id="main" tabIndex={-1}>
    <Outlet />
  </main>
);

export const Route = createFileRoute("/_site")({ component: SiteLayout });
