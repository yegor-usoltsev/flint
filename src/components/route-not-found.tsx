import { Link } from "@tanstack/react-router";
import { CompassIcon } from "lucide-react";

import { buttonVariants } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";

export const RouteNotFound = ({ inPage = false }: { inPage?: boolean }) => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <CompassIcon />
      </EmptyMedia>
      <EmptyTitle>
        {inPage ? <h2>Page not found</h2> : <h1>Page not found</h1>}
      </EmptyTitle>
      <EmptyDescription>
        There is nothing at this address. Check the link or head back home.
      </EmptyDescription>
    </EmptyHeader>
    <EmptyContent>
      <Link className={buttonVariants()} to="/">
        Back home
      </Link>
    </EmptyContent>
  </Empty>
);
