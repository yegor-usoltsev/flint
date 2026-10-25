import { createFileRoute } from "@tanstack/react-router";

import {
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "~/components/settings-page";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { pageHead } from "~/lib/site";
import { isTheme, setTheme, themeItems, useTheme } from "~/lib/theme";

const Preferences = () => {
  const theme = useTheme();

  return (
    <SettingsPage title="Preferences">
      <SettingsSection title="Interface and theme">
        <SettingsRow
          description="Follow the system setting or pick light or dark"
          htmlFor="interface-theme"
          label="Interface theme"
        >
          <Select
            items={themeItems}
            onValueChange={(value) => {
              if (isTheme(value)) {
                setTheme(value);
              }
            }}
            value={theme}
          >
            <SelectTrigger id="interface-theme">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {themeItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsSection>
    </SettingsPage>
  );
};

export const Route = createFileRoute("/$slug/settings/account/preferences")({
  component: Preferences,
  head: () => pageHead("Preferences"),
});
