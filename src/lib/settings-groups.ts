import {
  BoxIcon,
  KeyRoundIcon,
  LayoutGridIcon,
  SlidersHorizontalIcon,
  TagIcon,
  Trash2Icon,
  UserRoundIcon,
  UsersRoundIcon,
} from "lucide-react";

export const settingsGroups = [
  {
    items: [
      {
        icon: SlidersHorizontalIcon,
        label: "Preferences",
        to: "/$slug/settings/account/preferences",
      },
      {
        icon: UserRoundIcon,
        label: "Profile",
        to: "/$slug/settings/account/profile",
      },
      {
        icon: KeyRoundIcon,
        label: "API keys",
        to: "/$slug/settings/account/api-keys",
      },
    ],
    label: "Account",
  },
  {
    items: [
      {
        icon: LayoutGridIcon,
        label: "General",
        to: "/$slug/settings/workspace",
      },
      {
        icon: UsersRoundIcon,
        label: "Members",
        to: "/$slug/settings/members",
      },
      {
        icon: BoxIcon,
        label: "Projects",
        to: "/$slug/settings/projects",
      },
      { icon: TagIcon, label: "Labels", to: "/$slug/settings/labels" },
      { icon: Trash2Icon, label: "Trash", to: "/$slug/settings/trash" },
    ],
    label: "Workspace",
  },
] as const;
