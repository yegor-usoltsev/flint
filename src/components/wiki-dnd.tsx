import { pointerIntersection } from "@dnd-kit/collision";
import {
  KeyboardSensor,
  PointerActivationConstraints,
  PointerSensor,
} from "@dnd-kit/dom";
import type { Customizable, Sensors } from "@dnd-kit/dom";
import {
  DragDropProvider,
  DragOverlay,
  useDraggable,
  useDroppable,
} from "@dnd-kit/react";
import type { DragDropEventHandlers } from "@dnd-kit/react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { FileTextIcon, FolderIcon } from "lucide-react";
import { createContext, use, useRef, useState } from "react";
import type { ReactNode } from "react";

import { toast } from "~/components/ui/toast";
import { useCurrentWikiPath } from "~/components/wiki-actions";
import { ApiError } from "~/lib/api";
import type { WikiPageSummary } from "~/lib/api-types";
import {
  dropPlacement,
  findNode,
  inSubtree,
  moveNode,
  movedPath,
  wikiTarget,
} from "~/lib/wiki";
import type { DropZone, Wiki, WikiNode } from "~/lib/wiki";

const sensors: Customizable<Sensors> = (defaults) => [
  ...defaults.filter(
    (sensor) => sensor !== PointerSensor && sensor !== KeyboardSensor
  ),
  KeyboardSensor.configure({
    keyboardCodes: {
      cancel: ["Escape"],
      down: ["ArrowDown"],
      end: ["Space", "Enter", "Tab"],
      left: ["ArrowLeft"],
      right: ["ArrowRight"],
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

interface Drop {
  path: string;
  zone: DropZone;
}

const DropContext = createContext<Drop | null>(null);

export const NodeIcon = ({ node }: { node: WikiNode }) => {
  const Icon = node.page?.kind === "page" ? FileTextIcon : FolderIcon;

  return <Icon aria-hidden />;
};

const zoneAt = (y: number, top: number, height: number): DropZone => {
  const offset = (y - top) / height;

  if (offset < 0.3) {
    return "before";
  }

  return offset > 0.7 ? "after" : "inside";
};

export const WikiDragDrop = ({
  children,
  tree,
  wiki,
}: {
  children: ReactNode;
  tree: WikiNode[];
  wiki: Wiki;
}) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const current = useCurrentWikiPath(wiki) ?? "";
  const [drop, setDrop] = useState<Drop | null>(null);

  const track: DragDropEventHandlers["onDragMove"] = (_event, manager) => {
    const { position, source, target } = manager.dragOperation;
    const rect = target?.shape?.boundingRectangle;

    if (target === null || rect === undefined || source === null) {
      setDrop(null);

      return;
    }

    const next = {
      path: String(target.id),
      zone: zoneAt(position.current.y, rect.top, rect.height),
    };

    if (dropPlacement(tree, String(source.id), next.path, next.zone) === null) {
      setDrop(null);

      return;
    }

    setDrop((last) =>
      last?.path === next.path && last.zone === next.zone ? last : next
    );
  };

  const move = async (
    node: WikiPageSummary,
    placement: { path: string; sortKey: string }
  ) => {
    try {
      const moved = await moveNode(
        queryClient,
        wiki,
        node,
        placement.path,
        placement.sortKey
      );

      if (inSubtree(current, node.path) && moved.path !== node.path) {
        await navigate({
          ...wikiTarget(wiki, movedPath(current, node.path, moved.path)),
          replace: true,
        });
      }
    } catch (error) {
      const conflict = error instanceof ApiError && error.status === 409;
      const message = error instanceof Error ? error.message : String(error);

      toast.add({
        description: conflict
          ? `Something already exists at ${placement.path}`
          : message,
        title: `Could not move ${node.title}`,
        type: "error",
      });
    }
  };

  const onDragEnd: DragDropEventHandlers["onDragEnd"] = (event) => {
    const source = String(event.operation.source?.id);
    const node = findNode(tree, source)?.page;

    const placement =
      drop === null ? null : dropPlacement(tree, source, drop.path, drop.zone);

    setDrop(null);

    if (event.canceled || node === undefined || placement === null) {
      return;
    }

    void move(node, placement);
  };

  return (
    <DragDropProvider
      onDragEnd={onDragEnd}
      onDragMove={track}
      onDragOver={track}
      sensors={sensors}
    >
      <DropContext value={drop}>{children}</DropContext>
      <DragOverlay>
        {(source) => {
          const node = findNode(tree, String(source.id));

          return node === undefined ? null : (
            <div className="bg-popover text-popover-foreground shadow-raised flex h-7 w-fit max-w-56 items-center gap-2 rounded-md border px-2 text-sm [&>svg]:size-4 [&>svg]:shrink-0">
              <NodeIcon node={node} />
              <span className="truncate">{node.title}</span>
            </div>
          );
        }}
      </DragOverlay>
    </DragDropProvider>
  );
};

export const useWikiDrag = <Row extends HTMLElement>(node: WikiNode) => {
  const row = useRef<Row>(null);
  const drop = use(DropContext);

  const { handleRef, isDragSource } = useDraggable({
    disabled: node.page === undefined,
    element: row,
    id: node.path,
  });

  useDroppable({
    collisionDetector: pointerIntersection,
    element: row,
    id: node.path,
  });

  return {
    dragging: isDragSource,
    handleRef,
    row,
    zone: drop?.path === node.path ? drop.zone : null,
  };
};
