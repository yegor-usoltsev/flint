import type { UseQueryResult } from "@tanstack/react-query";
import { useLocation } from "@tanstack/react-router";

import { LoadFailed } from "~/components/load-failed";
import { RouteNotFound } from "~/components/route-not-found";
import { SignIn } from "~/components/sign-in";
import { isNotFound, useMe } from "~/lib/api";

const Body = ({ query, title }: { query: UseQueryResult; title: string }) => {
  const href = useLocation({ select: (location) => location.href });

  if (useMe().data === null) {
    return <SignIn returnTo={href} />;
  }

  if (query.isError) {
    return isNotFound(query.error) ? (
      <RouteNotFound />
    ) : (
      <div className="flex w-full flex-col gap-4">
        <h1 className="sr-only">{title}</h1>
        <LoadFailed
          error={query.error}
          onRetry={() => {
            void query.refetch();
          }}
          title={`Could not open ${title}`}
        />
      </div>
    );
  }

  return (
    <h1 aria-busy className="sr-only">
      Opening {title}
    </h1>
  );
};

export const LinkResolver = (props: {
  query: UseQueryResult;
  title: string;
}) => (
  <main className="flex min-h-dvh p-4" id="main">
    <Body {...props} />
  </main>
);
