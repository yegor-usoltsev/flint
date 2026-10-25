import { useRouter } from "@tanstack/react-router";
import type { MouseEvent } from "react";

let appHref: string | null = null;

export const isAppPath = (pathname: string, slug: string) =>
  pathname.startsWith(`/${slug}/`) &&
  !/^\/[^/]+\/settings(?:\/|$)/u.test(pathname);

export const rememberAppLocation = (location: {
  href: string;
  pathname: string;
}) => {
  const slug = location.pathname.split("/")[1] ?? "";

  if (isAppPath(location.pathname, slug)) {
    appHref = location.href;
  }
};

export const useBackToApp = (slug: string) => {
  const router = useRouter();

  return (event?: MouseEvent) => {
    const href = appHref?.startsWith(`/${slug}/`) === true ? appHref : null;

    if (href === null) {
      if (event === undefined) {
        void router.navigate({ params: { slug }, to: "/$slug/my-issues" });
      }

      return;
    }

    event?.preventDefault();
    router.history.push(href);
  };
};
