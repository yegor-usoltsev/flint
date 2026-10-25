import { createFileRoute } from "@tanstack/react-router";

import { RouteNotFound } from "~/components/route-not-found";
import { SettingsHeader } from "~/components/settings-page";

const SettingsNotFound = () => (
  <>
    <SettingsHeader />
    <div className="flex min-h-0 flex-1 overflow-y-auto p-4">
      <RouteNotFound />
    </div>
  </>
);

export const Route = createFileRoute("/$slug/settings")({
  notFoundComponent: SettingsNotFound,
});
