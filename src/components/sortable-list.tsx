import { RestrictToVerticalAxis } from "@dnd-kit/abstract/modifiers";
import {
  KeyboardSensor,
  PointerActivationConstraints,
  PointerSensor,
} from "@dnd-kit/dom";
import type { Customizable, Sensors } from "@dnd-kit/dom";
import { DragDropProvider } from "@dnd-kit/react";
import type { DragDropEventHandlers } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { GripVerticalIcon } from "lucide-react";
import type { ReactNode, Ref } from "react";

import { request } from "~/lib/api";
import type { LabelSummary, ProjectSummary } from "~/lib/api-types";
import { notifyError } from "~/lib/notify";
import { labelsQuery, projectsQuery } from "~/lib/queries";

const sensors: Customizable<Sensors> = (defaults) => [
  ...defaults.filter(
    (sensor) => sensor !== PointerSensor && sensor !== KeyboardSensor
  ),
  KeyboardSensor.configure({
    keyboardCodes: {
      cancel: ["Escape"],
      down: ["ArrowDown"],
      end: ["Space", "Enter", "Tab"],
      left: [],
      right: [],
      start: ["Space"],
      up: ["ArrowUp"],
    },
  }),
  PointerSensor.configure({
    activationConstraints: [
      new PointerActivationConstraints.Distance({ value: 4 }),
    ],
    preventActivation: (event, source) =>
      event.pointerType === "touch" ||
      PointerSensor.defaults.preventActivation?.(event, source) === true,
  }),
];

const transition = {
  duration: 150,
  easing: "cubic-bezier(0.23, 1, 0.32, 1)",
  idle: false,
};

export const SortableList = ({
  children,
  onMove,
}: {
  children: ReactNode;
  onMove: (id: string, index: number) => void;
}) => {
  const onDragEnd: DragDropEventHandlers["onDragEnd"] = (event) => {
    const { source } = event.operation;

    if (
      !event.canceled &&
      isSortable(source) &&
      source.index !== source.initialIndex
    ) {
      onMove(String(source.id), source.index);
    }
  };

  return (
    <DragDropProvider
      modifiers={[RestrictToVerticalAxis]}
      onDragEnd={onDragEnd}
      sensors={sensors}
    >
      {children}
    </DragDropProvider>
  );
};

export const DragHandle = ({
  handleRef,
  label,
}: {
  handleRef: Ref<HTMLButtonElement>;
  label: string;
}) => (
  <button
    aria-label={label}
    className="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute top-1/2 left-1 z-10 flex size-6 -translate-y-1/2 cursor-grab items-center justify-center rounded-md opacity-0 outline-none group-hover/sortable:opacity-100 focus-visible:opacity-100 focus-visible:ring-1 pointer-coarse:hidden"
    ref={handleRef}
    type="button"
  >
    <GripVerticalIcon aria-hidden className="size-4" />
  </button>
);

export const useSortableItem = ({
  disabled,
  group,
  id,
  index,
}: {
  disabled: boolean;
  group: string;
  id: string;
  index: number;
}) => {
  const sortable = useSortable({
    disabled,
    group,
    id,
    index,
    transition,
    type: group,
  });

  return disabled
    ? { handleRef: null, isDragSource: false, ref: null }
    : sortable;
};

export const useReorder = <Item extends { id: string }>({
  failure,
  queryKey,
  send,
}: {
  failure: string;
  queryKey: QueryKey;
  send: (item: Item, after: Item | null) => Promise<void>;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({ after, item }: { after: Item | null; item: Item }) => {
      await send(item, after);
    },
    onError: (error, _variables, previous) => {
      queryClient.setQueryData(queryKey, previous);
      notifyError(failure)(error);
    },
    onMutate: async ({ after, item }) => {
      await queryClient.cancelQueries({ queryKey });

      const previous = queryClient.getQueryData<Item[]>(queryKey);
      queryClient.setQueryData<Item[]>(queryKey, (items) => {
        const rest = items?.filter((other) => other.id !== item.id) ?? [];

        const index =
          after === null
            ? 0
            : rest.findIndex((other) => other.id === after.id) + 1;

        return rest.toSpliced(index, 0, item);
      });

      return previous;
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey });
    },
  });

  const move = (items: Item[], id: string, index: number) => {
    const item = items.find((other) => other.id === id);

    if (item === undefined) {
      return;
    }

    const rest = items.filter((other) => other.id !== id);

    mutation.mutate({ after: rest[index - 1] ?? null, item });
  };

  return { move, moving: mutation.isPending };
};

export const useReorderProjects = (slug: string) =>
  useReorder<ProjectSummary>({
    failure: "Project not moved",
    queryKey: projectsQuery(slug).queryKey,
    send: async (item, after) => {
      await request("PATCH /projects/:key", {
        body: { after: after?.key ?? null },
        params: { key: item.key },
      });
    },
  });

export const useReorderLabels = (slug: string) =>
  useReorder<LabelSummary>({
    failure: "Label not moved",
    queryKey: labelsQuery(slug).queryKey,
    send: async (item, after) => {
      await request("PATCH /labels/:labelId", {
        body: { after: after?.id ?? null },
        params: { labelId: item.id },
      });
    },
  });
