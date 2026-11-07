import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { cn } from "cn";
import { EllipsisIcon, PencilIcon, TrashIcon } from "lucide-react";
import { useState } from "react";
import type { SubmitEvent } from "react";

import { ColorPicker } from "~/components/color-picker";
import { LoadFailed } from "~/components/load-failed";
import {
  SettingsFilter,
  SettingsPage,
  SettingsTable,
  TableEmpty,
  tableHead,
  tableNumber,
  tableRow,
  useSettingsSave,
} from "~/components/settings-page";
import {
  DragHandle,
  SortableList,
  useReorderLabels,
  useSortableItem,
} from "~/components/sortable-list";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { FieldError } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import { request } from "~/lib/api";
import type { Label, LabelSummary } from "~/lib/api-types";
import { colors } from "~/lib/colors";
import type { Color } from "~/lib/colors";
import { notifyError } from "~/lib/notify";
import { labelsQuery } from "~/lib/queries";
import { pageHead } from "~/lib/site";
import { useAutosaveText } from "~/lib/use-autosave-text";
import { useWorkspace } from "~/lib/use-workspace";

const nextColor = (count: number) =>
  colors[(count % (colors.length - 1)) + 1] ?? "blue";

const CreateLabel = ({
  count,
  onDone,
  slug,
}: {
  count: number;
  onDone: () => void;
  slug: string;
}) => {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [color, setColor] = useState<Color>(() => nextColor(count));

  const create = useMutation({
    mutationFn: async () =>
      await request("POST /workspaces/:slug/labels", {
        body: { color, name },
        params: { slug },
      }),
    onSuccess: async () => {
      onDone();
      await queryClient.invalidateQueries({
        queryKey: labelsQuery(slug).queryKey,
      });
    },
  });

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <form
      className="bg-surface-1 flex flex-col gap-1 rounded-md p-2"
      onSubmit={submit}
    >
      <div className="flex items-center gap-2">
        <ColorPicker
          label="New label color"
          onChange={setColor}
          value={color}
        />
        <Input
          aria-describedby={create.isError ? "create-label-error" : undefined}
          aria-invalid={create.isError || undefined}
          aria-label="New label name"
          autoComplete="off"
          autoFocus
          maxLength={40}
          onChange={(event) => {
            setName(event.target.value);
            create.reset();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              onDone();
            }
          }}
          placeholder="Label name"
          required
          value={name}
        />
        <Button onClick={onDone} variant="ghost">
          Cancel
        </Button>
        <Button disabled={create.isPending} type="submit">
          Create
        </Button>
      </div>
      {create.isError ? (
        <FieldError id="create-label-error">{create.error.message}</FieldError>
      ) : null}
    </form>
  );
};

const usage = (count: number) => {
  if (count === 0) {
    return "No issue has this label.";
  }

  return count === 1
    ? "It is removed from 1 issue."
    : `It is removed from ${count} issues.`;
};

const LabelMenu = ({
  label,
  onDelete,
}: {
  label: LabelSummary;
  onDelete: () => void;
}) => {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex pointer-fine:opacity-0 pointer-fine:group-hover/sortable:opacity-100 pointer-fine:focus-within:opacity-100 pointer-fine:has-data-popup-open:opacity-100">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={`Actions for ${label.name}`}
              size="icon-sm"
              variant="quiet"
            />
          }
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem
            onClick={() => {
              setConfirming(true);
            }}
            variant="destructive"
          >
            <TrashIcon />
            Delete label…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteLabel
        label={label}
        onDelete={onDelete}
        onOpenChange={setConfirming}
        open={confirming}
      />
    </div>
  );
};

const DeleteLabel = ({
  label,
  onDelete,
  onOpenChange,
  open,
}: {
  label: LabelSummary;
  onDelete: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) => (
  <AlertDialog onOpenChange={onOpenChange} open={open}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete “{label.name}”?</AlertDialogTitle>
        <AlertDialogDescription>
          {usage(label.issueCount)}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction onClick={onDelete} variant="destructive">
          Delete
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

const LabelRow = ({
  index,
  moving,
  label,
  slug,
  sorting,
}: {
  index: number;
  moving: boolean;
  label: LabelSummary;
  slug: string;
  sorting: boolean;
}) => {
  const queryClient = useQueryClient();

  const { handleRef, isDragSource, ref } = useSortableItem({
    disabled: !sorting || moving,
    group: "labels",
    id: label.id,
    index,
  });

  const { queryKey } = labelsQuery(slug);

  const optimistic = {
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey });
    },
  };

  const update = useMutation({
    ...optimistic,
    mutationFn: async (changes: Partial<Pick<Label, "color" | "name">>) =>
      await request("PATCH /labels/:labelId", {
        body: changes,
        params: { labelId: label.id },
      }),
    onMutate: async (changes) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, (labels) =>
        labels?.map((item) =>
          item.id === label.id ? { ...item, ...changes } : item
        )
      );

      return previous;
    },
    onError: (_error, _changes, previous) => {
      queryClient.setQueryData(queryKey, previous);
    },
  });

  const { save, saveInBackground } = useSettingsSave();

  const remove = useMutation({
    ...optimistic,
    mutationFn: async () => {
      await request("DELETE /labels/:labelId", {
        params: { labelId: label.id },
      });
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, (labels) =>
        labels?.filter((item) => item.id !== label.id)
      );

      return previous;
    },
    onError: (error, _variables, previous) => {
      queryClient.setQueryData(queryKey, previous);
      notifyError("Label not deleted")(error);
    },
  });

  const name = useAutosaveText(label.name, async (text, retry) => {
    await save(
      `${label.id}:name`,
      async () => {
        await update.mutateAsync({ name: text });
      },
      retry
    );
  });

  const problem = name.status === "error" ? name.problem : null;

  return (
    <li
      className={cn(
        tableRow,
        "group/sortable data-dragging:bg-popover data-dragging:shadow-raised pl-8 data-dragging:z-10 pointer-coarse:pl-2"
      )}
      data-dragging={isDragSource ? "" : undefined}
      ref={ref}
    >
      {sorting ? (
        <DragHandle handleRef={handleRef} label={`Move ${label.name}`} />
      ) : null}
      <ColorPicker
        label={`Color of ${label.name}`}
        onChange={(color) => {
          saveInBackground(`${label.id}:color`, async () => {
            await update.mutateAsync({ color });
          });
        }}
        value={label.color}
      />
      <div className="flex min-w-0 flex-1">
        <div className="group/name relative min-w-0">
          <input
            aria-describedby={
              problem === null ? undefined : `label-${label.id}-problem`
            }
            aria-invalid={problem !== null || undefined}
            aria-label={`Name of ${label.name}`}
            className="hover:border-input hover:bg-background focus-visible:border-ring focus-visible:bg-background focus-visible:ring-ring/50 aria-invalid:border-destructive field-sizing-content h-8 max-w-full min-w-16 cursor-text rounded-lg border border-transparent bg-transparent pr-8 pl-2.5 text-base outline-none focus-visible:ring-3 max-sm:h-10 md:text-sm"
            maxLength={40}
            onBlur={() => {
              void name.flush();
            }}
            onChange={(event) => {
              name.edit(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void name.flush();
              }

              if (event.key === "Escape") {
                name.revert();
              }
            }}
            readOnly={name.status === "saving"}
            value={name.text}
          />
          <PencilIcon
            aria-hidden
            className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 group-focus-within/name:hidden pointer-fine:opacity-0 pointer-fine:group-hover/name:opacity-100"
          />
        </div>
      </div>
      {problem === null ? null : (
        <p
          className="text-destructive max-w-40 text-xs"
          id={`label-${label.id}-problem`}
          role="alert"
        >
          {problem}
        </p>
      )}
      <span className={cn(tableNumber, "max-sm:w-8")}>
        {label.issueCount}
        <span className="sr-only"> issues</span>
      </span>
      <LabelMenu
        label={label}
        onDelete={() => {
          remove.mutate();
        }}
      />
    </li>
  );
};

const Labels = () => {
  const workspace = useWorkspace();
  const labels = useQuery(labelsQuery(workspace.slug));
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");
  const words = filter.trim().toLowerCase();
  const empty = labels.data?.length === 0;
  const reorder = useReorderLabels(workspace.slug);

  const shown = labels.data?.filter((label) =>
    label.name.toLowerCase().includes(words)
  );

  return (
    <SettingsPage
      actions={
        <Button
          onClick={() => {
            setCreating(true);
          }}
        >
          New label
        </Button>
      }
      description="Labels are shared by every project in this workspace."
      title="Labels"
    >
      <div className="flex flex-col gap-2">
        {empty ? null : (
          <SettingsFilter
            label="Filter by name"
            onChange={setFilter}
            value={filter}
          />
        )}
        <SettingsTable>
          {empty ? null : (
            <div aria-hidden className={tableHead}>
              <span className="flex-1 pl-20 pointer-coarse:pl-14">Name</span>
              <span className={cn(tableNumber, "max-sm:w-8")}>Issues</span>
              <span className="w-7 max-sm:w-10" />
            </div>
          )}
          {labels.isPending ? <Skeleton className="h-20 w-full" /> : null}
          {labels.isError && labels.data === undefined ? (
            <LoadFailed
              error={labels.error}
              onRetry={() => {
                void labels.refetch();
              }}
              title="Labels could not load"
            />
          ) : null}
          {shown?.length === 0 && !creating ? (
            <TableEmpty
              action={
                <Button
                  onClick={() => {
                    setCreating(true);
                  }}
                >
                  New label
                </Button>
              }
              description="Add labels like Bug or Feature to sort issues."
              filter={filter.trim()}
              onClearFilter={() => {
                setFilter("");
              }}
              title="No labels yet"
            />
          ) : null}
          {shown === undefined || shown.length === 0 ? null : (
            <SortableList
              onMove={(id, index) => {
                reorder.move(labels.data ?? [], id, index);
              }}
            >
              <ul aria-label="Labels">
                {shown.map((label, index) => (
                  <LabelRow
                    index={index}
                    key={label.id}
                    label={label}
                    slug={workspace.slug}
                    moving={reorder.moving}
                    sorting={words === ""}
                  />
                ))}
              </ul>
            </SortableList>
          )}
          {creating && labels.data !== undefined ? (
            <CreateLabel
              count={labels.data.length}
              onDone={() => {
                setCreating(false);
              }}
              slug={workspace.slug}
            />
          ) : null}
        </SettingsTable>
      </div>
    </SettingsPage>
  );
};

export const Route = createFileRoute("/$slug/settings/labels")({
  component: Labels,
  head: () => pageHead("Labels"),
});
