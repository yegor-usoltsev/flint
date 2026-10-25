import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { TrashIcon } from "lucide-react";
import { useState } from "react";
import type { SubmitEvent } from "react";

import { ColorPicker } from "~/components/color-picker";
import { SaveState } from "~/components/conflict-dialog";
import { LoadFailed } from "~/components/load-failed";
import {
  SettingsFilter,
  SettingsPage,
  TableEmpty,
  tableHead,
  tableNumber,
  tableRow,
} from "~/components/settings-page";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
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

const DeleteLabel = ({
  label,
  onDelete,
}: {
  label: LabelSummary;
  onDelete: () => void;
}) => (
  <AlertDialog>
    <AlertDialogTrigger
      render={
        <Button
          aria-label={`Delete ${label.name}`}
          size="icon-sm"
          variant="ghost"
        />
      }
    >
      <TrashIcon />
    </AlertDialogTrigger>
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

const LabelRow = ({ label, slug }: { label: LabelSummary; slug: string }) => {
  const queryClient = useQueryClient();
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
    onError: (error, _changes, previous) => {
      queryClient.setQueryData(queryKey, previous);
      notifyError("Label not saved")(error);
    },
  });

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

  const name = useAutosaveText(label.name, async (text) => {
    await update.mutateAsync({ name: text });
  });

  return (
    <li className={tableRow}>
      <ColorPicker
        label={`Color of ${label.name}`}
        onChange={(color) => {
          update.mutate({ color });
        }}
        value={label.color}
      />
      <input
        aria-label={`Name of ${label.name}`}
        className="hover:border-input focus-visible:border-ring focus-visible:ring-ring/50 h-8 min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2.5 text-base outline-none focus-visible:ring-3 md:text-sm"
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
      {name.status === "idle" ? null : (
        <SaveState
          onRetry={() => {
            void name.flush();
          }}
          problem={name.problem}
          status={name.status}
        />
      )}
      <span className={tableNumber}>
        {label.issueCount}
        <span className="sr-only"> issues</span>
      </span>
      <DeleteLabel
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
          size="pill"
        >
          New label
        </Button>
      }
      description="Labels are shared by every project in this workspace. Click a name to rename it."
      title="Labels"
      wide
    >
      <div className="flex flex-col gap-2">
        {empty ? null : (
          <>
            <SettingsFilter
              label="Filter by name"
              onChange={setFilter}
              value={filter}
            />
            <div aria-hidden className={tableHead}>
              <span className="flex-1 pl-10">Name</span>
              <span className={tableNumber}>Issues</span>
              <span className="w-7" />
            </div>
          </>
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
                size="pill"
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
          <ul aria-label="Labels">
            {shown.map((label) => (
              <LabelRow key={label.id} label={label} slug={workspace.slug} />
            ))}
          </ul>
        )}
      </div>
    </SettingsPage>
  );
};

export const Route = createFileRoute("/$slug/settings/labels")({
  component: Labels,
  head: () => pageHead("Labels"),
});
