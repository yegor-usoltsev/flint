import { useMatches } from "@tanstack/react-router";
import { useEffect } from "react";

export const site = {
  description: "Issue tracker and knowledge base",
  name: "Flint",
} as const;

const pageTitle = (page: string) => `${page} · ${site.name}`;

export const pageHead = (page: string) => ({
  meta: [{ title: pageTitle(page) }],
});

export const usePageTitle = (page: string | undefined) => {
  const headTitle = useMatches({
    select: (matches) =>
      matches
        .flatMap((match) => match.meta ?? [])
        .findLast((meta) => meta?.title !== undefined)?.title,
  });

  useEffect(() => {
    const title = page === undefined ? headTitle : pageTitle(page);

    if (title !== undefined) {
      document.title = title;
    }
  }, [page, headTitle]);
};
