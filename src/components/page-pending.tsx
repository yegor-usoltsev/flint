import { Skeleton } from "~/components/ui/skeleton";

export const PagePending = () => (
  <div aria-busy className="flex min-h-0 flex-1 flex-col">
    <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
      <h1 className="sr-only">Loading</h1>
      <Skeleton className="h-4 w-40" />
    </header>
    <div className="flex flex-col gap-2 p-2">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-2/3" />
    </div>
  </div>
);
