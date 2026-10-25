import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";
import { createContext, use, useCallback, useRef, useState } from "react";
import type { RefObject, ReactNode } from "react";

import { IssueProperties } from "~/components/issue-properties";
import { LazyMarkdownEditor } from "~/components/lazy-editor";
import type { MarkdownEditorHandle } from "~/components/markdown-editor";
import { SubmitHint } from "~/components/shortcuts-dialog";
import { Swatch } from "~/components/swatch";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { FieldError } from "~/components/ui/field";
import { Switch } from "~/components/ui/switch";
import { api, ApiError } from "~/lib/api";
import type { Issue, IssueSummary, ProjectDetail } from "~/lib/api-types";
import { countChecklist } from "~/lib/checklist";
import { newId } from "~/lib/ids";
import { sortKeyBetween } from "~/lib/issue-view";
import {
  draftKey,
  emptyText,
  readDraft,
  restoreSubmitted,
  savedProperties,
  setCreateError,
  settleSubmitted,
  titleLimit,
  useCreateError,
  writeDraft,
} from "~/lib/new-issue-draft";
import type { DraftText, Properties, Submitted } from "~/lib/new-issue-draft";
import { notifyWithAction } from "~/lib/notify";
import { issuesQuery, projectQuery, projectsQuery } from "~/lib/queries";
import { useStoredText } from "~/lib/use-draft";
import { useCommands } from "~/lib/use-hotkey";
import { withLabelChanges } from "~/lib/use-update-issue";
import { useWorkspace } from "~/lib/use-workspace";

interface CreateTarget {
  projectKey?: string;
  statusId?: string;
}

interface NewIssue extends Properties {
  description: string;
  id: string;
  sortKey: string;
  title: string;
}

const CreateIssueContext = createContext<
  ((target?: CreateTarget) => void) | null
>(null);

export const useCreateIssue = () => {
  const open = use(CreateIssueContext);

  if (open === null) {
    throw new Error("CreateIssueProvider is missing");
  }

  return open;
};

const toSummary = ({
  deletedAt: _deleted,
  description: _description,
  links: _links,
  ...summary
}: Issue): IssueSummary => summary;

const replaceIssue = (
  queryClient: QueryClient,
  project: ProjectDetail,
  id: string,
  issue: IssueSummary | null
) => {
  queryClient.setQueryData<IssueSummary[]>(
    issuesQuery(project).queryKey,
    (issues) =>
      issues?.flatMap((item) => {
        if (item.id !== id) {
          return [item];
        }

        return issue === null ? [] : [issue];
      })
  );
};

const pendingIssue = (
  project: ProjectDetail,
  draft: NewIssue
): IssueSummary => {
  const { done, total } = countChecklist(draft.description);
  const now = new Date().toISOString();

  return {
    ...draft,
    canceledAt: null,
    checklistDone: done,
    checklistTotal: total,
    ciState: null,
    completedAt: null,
    createdAt: now,
    creatorId: "",
    key: `${project.key}-?`,
    number: 0,
    projectId: project.id,
    pullRequestState: null,
    updatedAt: now,
    version: 0,
  };
};

const useSubmitIssue = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const workspace = useWorkspace();
  const openCreate = use(CreateIssueContext);

  const submit = async (
    project: ProjectDetail,
    draft: NewIssue,
    submitted: Submitted
  ) => {
    const { queryKey } = issuesQuery(project);

    await queryClient.cancelQueries({ queryKey });
    queryClient.setQueryData<IssueSummary[]>(queryKey, (issues) =>
      issues === undefined ? issues : [...issues, pendingIssue(project, draft)]
    );

    try {
      const issue = await api<Issue>(`/projects/${project.key}/issues`, {
        body: draft,
        method: "POST",
      });

      replaceIssue(queryClient, project, draft.id, toSummary(issue));
      settleSubmitted(submitted);
      notifyWithAction({
        action: "Open",
        description: issue.title,
        onAction: () => {
          void navigate({
            params: { issueKey: issue.key, slug: workspace.slug },
            to: "/$slug/issue/$issueKey",
          });
        },
        title: `Created ${issue.key}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const invalid = error instanceof ApiError && error.status === 400;

      replaceIssue(queryClient, project, draft.id, null);
      restoreSubmitted(submitted, invalid ? message : null);
      notifyWithAction({
        action: invalid ? "Edit" : "Retry",
        description: message,
        onAction: () => {
          if (invalid) {
            openCreate?.({ projectKey: project.key });
          } else {
            void submit(project, draft, submitted);
          }
        },
        title: `Could not create “${draft.title}”`,
        type: "error",
      });
    }

    await queryClient.invalidateQueries({ queryKey });
  };

  return submit;
};

const defaultProperties = (
  project: ProjectDetail,
  statusId?: string
): Properties => ({
  assigneeId: null,
  labelIds: [],
  priority: 0,
  statusId:
    statusId ??
    project.statuses.find((status) => status.category === "unstarted")?.id ??
    project.statuses[0]?.id ??
    "",
});

const ProjectPicker = ({
  onChange,
  project,
}: {
  onChange: (key: string) => void;
  project: ProjectDetail;
}) => {
  const workspace = useWorkspace();
  const projects = useQuery(projectsQuery(workspace.slug)).data ?? [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={`Project: ${project.name}`}
            size="xs"
            variant="outline"
          />
        }
      >
        <Swatch color={project.color} />
        {project.key}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuRadioGroup onValueChange={onChange} value={project.key}>
          {projects.map((item) => (
            <DropdownMenuRadioItem key={item.id} value={item.key}>
              <Swatch color={item.color} />
              <span className="truncate">{item.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const titleProblem = (title: string) => {
  const { length } = title.trim();

  if (length === 0) {
    return "A title is required";
  }

  return length > titleLimit
    ? `The title is ${length} characters; the limit is ${titleLimit}`
    : null;
};

const CreateForm = ({
  initialStatusId,
  onClose,
  onProjectChange,
  onTextChange,
  project,
  text: { description, title },
}: {
  initialStatusId?: string;
  onClose: () => void;
  onProjectChange: (key: string) => void;
  onTextChange: (change: (text: DraftText) => DraftText) => void;
  project: ProjectDetail;
  text: DraftText;
}) => {
  const queryClient = useQueryClient();
  const submit = useSubmitIssue();

  const [titleError, setTitleError] = useState<string | null>(null);
  const failure = useCreateError(project.key);

  const setTitle = (next: string) => {
    onTextChange((text) => ({ ...text, title: next }));

    if (titleError !== null) {
      setTitleError(titleProblem(next));
    }
  };

  const setDescription = (next: string) => {
    onTextChange((text) => ({ ...text, description: next }));
  };

  const [more, setMore] = useState(false);
  const [round, setRound] = useState(0);
  const titleInput = useRef<HTMLTextAreaElement>(null);
  const editor = useRef<MarkdownEditorHandle>(null);

  const [properties, setProperties] = useState(() => {
    const saved = savedProperties.get(project.key);

    return saved === undefined
      ? defaultProperties(project, initialStatusId)
      : { ...saved, statusId: initialStatusId ?? saved.statusId };
  });

  const changeProperties = (next: Properties) => {
    savedProperties.set(project.key, next);
    setProperties(next);
  };

  const create = () => {
    const problem = titleProblem(title);

    if (problem !== null) {
      setTitleError(problem);
      titleInput.current?.focus();

      return;
    }

    setCreateError(project.key, null);

    const first = queryClient
      .getQueryData<IssueSummary[]>(issuesQuery(project).queryKey)
      ?.filter((issue) => issue.statusId === properties.statusId)
      .toSorted((a, b) => (a.sortKey < b.sortKey ? -1 : 1))[0];

    void submit(
      project,
      {
        ...properties,
        description,
        id: newId(),
        sortKey: sortKeyBetween(undefined, first?.sortKey),
        title: title.trim(),
      },
      { projectKey: project.key, properties, text: { description, title } }
    );

    if (more) {
      onTextChange(() => emptyText);
      setRound(round + 1);
      titleInput.current?.focus();
    } else {
      onClose();
    }
  };

  const draft: IssueSummary = {
    ...properties,
    canceledAt: null,
    checklistDone: 0,
    checklistTotal: 0,
    ciState: null,
    completedAt: null,
    createdAt: "",
    creatorId: "",
    id: "new",
    key: "",
    number: 0,
    projectId: project.id,
    pullRequestState: null,
    sortKey: "",
    title,
    updatedAt: "",
    version: 0,
  };

  return (
    <form
      className="flex min-h-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        create();
      }}
    >
      <div className="flex items-center gap-1.5 px-4 pt-4">
        <ProjectPicker onChange={onProjectChange} project={project} />
        <ChevronRightIcon className="text-muted-foreground size-3.5" />
        <DialogTitle>New issue</DialogTitle>
        <DialogDescription className="sr-only">
          Write a title, an optional description and set properties.
        </DialogDescription>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pt-3 pb-2">
        <textarea
          aria-describedby={
            titleError === null ? undefined : "new-issue-title-error"
          }
          aria-invalid={titleError !== null}
          aria-label="Issue title"
          autoFocus
          className="placeholder:text-muted-foreground field-sizing-content w-full resize-none bg-transparent text-lg leading-7 font-semibold outline-none"
          onChange={(event) => {
            setTitle(event.target.value.replaceAll("\n", " "));
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) {
              return;
            }

            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              create();
            } else if (event.key === "Enter") {
              event.preventDefault();
              editor.current?.focus();
            }
          }}
          maxLength={titleLimit}
          placeholder="Issue title"
          ref={titleInput}
          rows={1}
          value={title}
        />
        {titleError === null ? null : (
          <FieldError id="new-issue-title-error">{titleError}</FieldError>
        )}
        <LazyMarkdownEditor
          className="text-prose min-h-20"
          key={round}
          label="Description"
          onChange={setDescription}
          onSubmit={create}
          placeholder="Add a description… Type / for blocks"
          ref={editor}
          value={description}
        />
      </div>
      {failure === null ? null : (
        <div className="px-4 pb-2">
          <FieldError>Could not create the issue: {failure}</FieldError>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5 px-4 pb-3">
        <IssueProperties
          issue={draft}
          layout="pills"
          onChange={(patch) => {
            changeProperties(withLabelChanges(properties, patch));
          }}
          project={project}
        />
      </div>
      <div className="bg-surface-1 flex items-center gap-3 rounded-b-xl border-t px-4 py-2.5">
        {/* oxlint-disable-next-line jsx-a11y/label-has-associated-control -- The Switch renders the control inside the label. */}
        <label className="text-muted-foreground flex items-center gap-2 text-xs">
          <Switch checked={more} onCheckedChange={setMore} size="sm" />
          Create more
        </label>
        <Button className="ml-auto" size="sm" type="submit">
          Create issue
          <SubmitHint />
        </Button>
      </div>
    </form>
  );
};

const CreateDialog = ({
  onOpenChange,
  open,
  opener,
  target,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  opener: RefObject<HTMLElement | null>;
  target: CreateTarget;
}) => {
  const workspace = useWorkspace();
  const projects = useQuery(projectsQuery(workspace.slug)).data ?? [];
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const key = chosen ?? target.projectKey ?? projects[0]?.key ?? "";
  const [title] = useStoredText(draftKey(key, "title"));
  const [description] = useStoredText(draftKey(key, "description"));
  const text = { description: description ?? "", title: title ?? "" };

  const setText = (change: (current: DraftText) => DraftText) => {
    writeDraft(key, change(readDraft(key)));
  };

  const changeProject = (next: string) => {
    const current = readDraft(key);

    writeDraft(key, emptyText);
    writeDraft(next, current);
    setChosen(next);
  };

  const project = useQuery({
    ...projectQuery(key),
    enabled: open && key !== "",
  });

  return (
    <Dialog
      onOpenChange={(next) => {
        onOpenChange(next);
        setChosen(undefined);
      }}
      open={open}
    >
      <DialogContent
        // oxlint-disable-next-line shadcn/no-restyle -- The form lays out its own padded sections and footer.
        className="top-[12vh] flex max-h-[80vh] translate-y-0 flex-col gap-0 p-0 sm:max-w-2xl"
        finalFocus={() =>
          opener.current?.isConnected === true ? opener.current : true
        }
        showCloseButton={false}
      >
        {project.data === undefined ? (
          <div className="p-4">
            <DialogTitle>New issue</DialogTitle>
            <DialogDescription>
              {projects.length === 0
                ? "Create a project first."
                : "Loading the project…"}
            </DialogDescription>
          </div>
        ) : (
          <CreateForm
            initialStatusId={chosen === undefined ? target.statusId : undefined}
            key={project.data.id}
            onClose={() => {
              onOpenChange(false);
            }}
            onProjectChange={changeProject}
            onTextChange={setText}
            project={project.data}
            text={text}
          />
        )}
      </DialogContent>
    </Dialog>
  );
};

export const CreateIssueProvider = ({ children }: { children: ReactNode }) => {
  const params = useParams({ strict: false });
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<CreateTarget>({});
  const opener = useRef<HTMLElement | null>(null);

  const routeProject =
    params.key ?? params.issueKey?.split("-")[0]?.toUpperCase();

  const openCreate = useCallback(
    (next: CreateTarget = {}) => {
      const active = document.activeElement;

      opener.current =
        active instanceof HTMLElement && active !== document.body
          ? active
          : null;
      setTarget({ projectKey: routeProject, ...next });
      setOpen(true);
    },
    [routeProject]
  );

  useCommands([
    {
      group: "Create",
      hotkey: { keys: "c" },
      id: "create-issue",
      label: "Create issue",
      run: () => {
        openCreate();
      },
    },
  ]);

  return (
    <CreateIssueContext value={openCreate}>
      {children}
      <CreateDialog
        onOpenChange={setOpen}
        open={open}
        opener={opener}
        target={target}
      />
    </CreateIssueContext>
  );
};
