import { createFileRoute } from "@tanstack/react-router";

import {
  SettingsChoice,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "~/components/settings-page";
import { setIssueOpening, useIssueOpening } from "~/lib/issue-panel";
import type { IssueOpening } from "~/lib/issue-panel";
import { pageHead } from "~/lib/site";
import { setTheme, themeItems, useTheme } from "~/lib/theme";

const openingItems = [
  { short: "Side panel", value: "panel" },
  { short: "Full page", value: "page" },
] as const satisfies readonly { short: string; value: IssueOpening }[];

const Preferences = () => {
  const theme = useTheme();
  const opening = useIssueOpening();

  return (
    <SettingsPage
      description="These settings apply to this browser."
      title="Preferences"
    >
      <SettingsSection>
        <SettingsRow
          description="Follow the system setting or pick light or dark"
          label="Theme"
        >
          <SettingsChoice
            items={themeItems}
            label="Theme"
            onChange={setTheme}
            value={theme}
          />
        </SettingsRow>
        <SettingsRow
          description="Clicking an issue in a list or board shows it in a side panel next to the list, when the window has room, or on its own page. Alt-click always uses the panel."
          label="Open issues in"
        >
          <SettingsChoice
            items={openingItems}
            label="Open issues in"
            onChange={setIssueOpening}
            value={opening}
          />
        </SettingsRow>
      </SettingsSection>
    </SettingsPage>
  );
};

export const Route = createFileRoute("/$slug/settings/account/preferences")({
  component: Preferences,
  head: () => pageHead("Preferences"),
});
