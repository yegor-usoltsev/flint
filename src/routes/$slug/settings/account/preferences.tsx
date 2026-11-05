import { createFileRoute } from "@tanstack/react-router";

import {
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "~/components/settings-page";
import { Button } from "~/components/ui/button";
import { pageHead } from "~/lib/site";
import { setTheme, themeItems, useTheme } from "~/lib/theme";

const Preferences = () => {
  const theme = useTheme();

  return (
    <SettingsPage title="Preferences">
      <SettingsSection>
        <SettingsRow
          description="Follow the system setting or pick light or dark"
          label="Theme"
        >
          <div className="bg-muted flex rounded-lg p-0.5">
            {themeItems.map((item) => (
              <Button
                aria-pressed={theme === item.value}
                key={item.value}
                onClick={() => {
                  setTheme(item.value);
                }}
                size="sm"
                variant={theme === item.value ? "outline" : "ghost"}
              >
                {item.short}
              </Button>
            ))}
          </div>
        </SettingsRow>
      </SettingsSection>
    </SettingsPage>
  );
};

export const Route = createFileRoute("/$slug/settings/account/preferences")({
  component: Preferences,
  head: () => pageHead("Preferences"),
});
