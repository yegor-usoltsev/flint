import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { useEffect } from "react";
import type { ReactNode } from "react";

import { RouteNotFound } from "~/components/route-not-found";
import { Toaster } from "~/components/ui/toast";
import { TooltipProvider } from "~/components/ui/tooltip";
import type { RouterContext } from "~/lib/preload";
import { site } from "~/lib/site";
import {
  applyTheme,
  subscribeTheme,
  themeColors,
  themeScript,
} from "~/lib/theme";

import appCss from "~/styles.css?url";

const RootDocument = ({ children }: { children: ReactNode }) => (
  <html lang="en" suppressHydrationWarning>
    <head>
      <HeadContent />
    </head>
    <body>
      {children}
      <Scripts />
    </body>
  </html>
);

const RootLayout = () => {
  useEffect(() => subscribeTheme(applyTheme), []);

  return (
    <Toaster>
      <TooltipProvider>
        <Outlet />
      </TooltipProvider>
    </Toaster>
  );
};

const RootNotFound = () => (
  <main className="flex min-h-dvh p-4" id="main">
    <RouteNotFound />
  </main>
);

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: RootNotFound,
  head: () => ({
    links: [
      { href: appCss, rel: "stylesheet" },
      { href: "/favicon.ico", rel: "icon", sizes: "16x16 32x32 48x48" },
      { href: "/favicon.svg", rel: "icon", type: "image/svg+xml" },
      {
        href: "/apple-touch-icon.png",
        rel: "apple-touch-icon",
        sizes: "180x180",
      },
      { href: "/site.webmanifest", rel: "manifest" },
    ],
    meta: [
      { charSet: "utf-8" },
      { content: "width=device-width, initial-scale=1", name: "viewport" },
      { title: site.name },
      { content: site.description, name: "description" },
      { content: "noindex, nofollow", name: "robots" },
      { content: "light dark", name: "color-scheme" },
      {
        content: themeColors.light,
        media: "(prefers-color-scheme: light)",
        name: "theme-color",
      },
      {
        content: themeColors.dark,
        media: "(prefers-color-scheme: dark)",
        name: "theme-color",
      },
    ],
    scripts: [{ children: themeScript }],
  }),
  shellComponent: RootDocument,
});
