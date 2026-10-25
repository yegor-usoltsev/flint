import { useQueryClient } from "@tanstack/react-query";
import { Extension } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { Suggestion } from "@tiptap/suggestion";
import type { SuggestionOptions } from "@tiptap/suggestion";
import { FileTextIcon } from "lucide-react";
import { useLayoutEffect, useRef } from "react";

import { StatusIcon } from "~/components/status-icon";
import {
  SuggestionList,
  useSuggestionMenu,
} from "~/components/suggestion-menu";
import type { IssueSummary, Status, WikiPageSummary } from "~/lib/api-types";
import { issuesQuery, projectQuery, projectsQuery } from "~/lib/queries";
import { allowedPrefixes, allowTrigger } from "~/lib/suggestion-trigger";
import { useWorkspace } from "~/lib/use-workspace";
import { wikiPagesQuery, workspaceWiki } from "~/lib/wiki";

type MentionItem =
  | { group: "Documents"; page: WikiPageSummary }
  | { group: "Issues"; issue: IssueSummary; status?: Status };

const limit = 5;

const rank = (needle: string, ...texts: string[]) => {
  const scores = texts.map((text) => {
    const lower = text.toLowerCase();

    if (lower === needle) {
      return -1;
    }

    if (lower.startsWith(needle)) {
      return 0;
    }

    if (lower.split(/[\s/-]+/u).some((word) => word.startsWith(needle))) {
      return 1;
    }

    return lower.includes(needle) ? 2 : 3;
  });

  return Math.min(...scores);
};

const pick = <Item extends { updatedAt: string }>(
  items: Item[],
  needle: string,
  texts: (item: Item) => string[]
) =>
  items
    .flatMap((item) => {
      const score = rank(needle, ...texts(item));

      return score < 3 ? [{ item, score }] : [];
    })
    .toSorted(
      (a, b) =>
        a.score - b.score || b.item.updatedAt.localeCompare(a.item.updatedAt)
    )
    .slice(0, limit)
    .map(({ item }) => item);

const mentionContent = (item: MentionItem): JSONContent =>
  item.group === "Issues"
    ? { attrs: { key: item.issue.key }, type: "issueMention" }
    : {
        attrs: { href: `/doc/${item.page.id}`, label: item.page.title },
        type: "pageMention",
      };

const MentionCommands = Extension.create<{
  items: (query: string) => Promise<MentionItem[]>;
  render?: SuggestionOptions<MentionItem, MentionItem>["render"];
}>({
  addOptions: () => ({ items: async () => await Promise.resolve([]) }),
  addProseMirrorPlugins() {
    const { items, render } = this.options;

    return [
      Suggestion<MentionItem, MentionItem>({
        allow: allowTrigger,
        allowedPrefixes,
        char: "@",
        command: ({ editor, props, range }) => {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent([mentionContent(props), { text: " ", type: "text" }])
            .run();
        },
        container: "[data-slot=dialog-content]",
        editor: this.editor,
        items: async ({ query }) => await items(query.trim().toLowerCase()),
        pluginKey: new PluginKey("mention"),
        render,
      }),
    ];
  },
  name: "mentionCommands",
});

// The `@` menu lists issues and documents, not people, because Flint has no notifications.
export const useMentionMenu = () => {
  const queryClient = useQueryClient();
  const workspace = useWorkspace();
  // The editor and its plugin outlive a workspace switch, so items read the current workspace when the menu opens.
  const live = useRef(workspace);

  useLayoutEffect(() => {
    live.current = workspace;
  });
  const { isOpen, menu, render, selected } = useSuggestionMenu<MentionItem>();

  const items = async (needle: string): Promise<MentionItem[]> => {
    const { current } = live;

    const projects = await queryClient.query({
      ...projectsQuery(current.slug),
      staleTime: "static",
    });

    const [lists, details, pages] = await Promise.all([
      Promise.all(
        projects.map(
          async (project) =>
            await queryClient.query({
              ...issuesQuery(project),
              staleTime: "static",
            })
        )
      ),
      Promise.all(
        projects.map(
          async (project) =>
            await queryClient.query({
              ...projectQuery(project.key),
              staleTime: "static",
            })
        )
      ),
      queryClient.query({
        ...wikiPagesQuery(workspaceWiki(current)),
        staleTime: "static",
      }),
    ]);

    const statuses = new Map(
      details.flatMap((project) =>
        project.statuses.map((status) => [status.id, status] as const)
      )
    );

    return [
      ...pick(lists.flat(), needle, (issue) => [issue.key, issue.title]).map(
        (issue): MentionItem => ({
          group: "Issues",
          issue,
          status: statuses.get(issue.statusId),
        })
      ),
      ...pick(
        pages.filter((page) => page.kind === "page"),
        needle,
        (page) => [page.title, page.path]
      ).map((page): MentionItem => ({ group: "Documents", page })),
    ];
  };

  return {
    // oxlint-disable-next-line react/refs -- The plugin calls items when the menu opens, not during render.
    extension: MentionCommands.configure({ items, render }),
    isOpen,
    menu:
      menu === null ? null : (
        <SuggestionList
          className="w-80 max-w-[calc(100vw-2rem)]"
          empty="No results found"
          groupOf={(item) => item.group}
          heading={(group) => group}
          label="Mentions"
          keyOf={(item) =>
            item.group === "Issues" ? item.issue.id : item.page.id
          }
          menu={menu}
          selected={selected}
        >
          {(item) =>
            item.group === "Issues" ? (
              <>
                {item.status === undefined ? null : (
                  <StatusIcon
                    category={item.status.category}
                    color={item.status.color}
                  />
                )}
                <span className="text-muted-foreground shrink-0">
                  {item.issue.key}
                </span>
                <span className="truncate">{item.issue.title}</span>
              </>
            ) : (
              <>
                <FileTextIcon />
                <span className="truncate">{item.page.title}</span>
              </>
            )
          }
        </SuggestionList>
      ),
  };
};
