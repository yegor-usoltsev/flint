import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { RefObject, SubmitEvent } from "react";

import { IconPicker } from "~/components/icon-picker";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { api } from "~/lib/api";
import type { Project, ProjectDetail } from "~/lib/api-types";
import type { Color } from "~/lib/colors";
import type { ProjectIcon } from "~/lib/project-icons";
import { projectQuery, projectsQuery } from "~/lib/queries";
import { suggestKey } from "~/lib/workspace";

const ProjectForm = ({
  onDone,
  project,
  slug,
}: {
  onDone: () => void;
  project?: Project;
  slug: string;
}) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState(project?.name ?? "");
  const [key, setKey] = useState<string | null>(null);
  const [color, setColor] = useState<Color>(project?.color ?? "blue");
  const [icon, setIcon] = useState<ProjectIcon>(project?.icon ?? "box");
  const effectiveKey = project?.key ?? key ?? suggestKey(name);

  const save = useMutation({
    mutationFn: async () =>
      project === undefined
        ? await api<ProjectDetail>(`/workspaces/${slug}/projects`, {
            body: { color, icon, key: effectiveKey, name },
            method: "POST",
          })
        : await api<ProjectDetail>(`/projects/${project.key}`, {
            body: { color, icon, name },
            method: "PATCH",
          }),
    onSuccess: async (saved) => {
      queryClient.setQueryData(projectQuery(saved.key).queryKey, saved);
      await queryClient.invalidateQueries({
        queryKey: projectsQuery(slug).queryKey,
      });
      onDone();

      if (project === undefined) {
        await navigate({
          params: { key: saved.key, slug },
          to: "/$slug/project/$key",
        });
      }
    },
  });

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <form className="flex flex-col gap-6" onSubmit={submit}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="project-name">Name</FieldLabel>
          <div className="flex gap-2">
            <IconPicker
              color={color}
              icon={icon}
              label="Icon"
              onChange={(change) => {
                setColor(change.color ?? color);
                setIcon(change.icon ?? icon);
              }}
            />
            <Input
              autoComplete="off"
              autoFocus
              id="project-name"
              maxLength={60}
              onChange={(event) => {
                setName(event.target.value);
              }}
              placeholder="Project name"
              required
              value={name}
            />
          </div>
        </Field>
        <Field>
          <FieldLabel htmlFor="project-key">Key</FieldLabel>
          <Input
            aria-describedby="project-key-hint"
            aria-invalid={save.isError || undefined}
            autoComplete="off"
            disabled={project !== undefined}
            id="project-key"
            maxLength={5}
            onChange={(event) => {
              setKey(event.target.value.toUpperCase());
            }}
            pattern="[A-Za-z][A-Za-z0-9]{1,4}"
            placeholder="KEY"
            required
            value={effectiveKey}
          />
          <FieldDescription id="project-key-hint">
            {project === undefined
              ? `Issues are numbered ${effectiveKey || "ENG"}-1, ${effectiveKey || "ENG"}-2… The key is unique across Flint and cannot change later.`
              : "The key cannot change."}
          </FieldDescription>
          {save.isError ? <FieldError>{save.error.message}</FieldError> : null}
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button disabled={save.isPending} type="submit">
          {project === undefined ? "Create project" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
};

export const ProjectDialog = ({
  opener,
  onOpenChange,
  open,
  project,
  slug,
}: {
  opener?: RefObject<HTMLElement | null>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  project?: Project;
  slug: string;
}) => (
  <Dialog onOpenChange={onOpenChange} open={open}>
    <DialogContent finalFocus={opener}>
      <DialogHeader>
        <DialogTitle>
          {project === undefined ? "Create project" : "Edit project"}
        </DialogTitle>
        <DialogDescription>
          {project === undefined
            ? "Projects hold issues and a board. Every project starts with the default statuses."
            : `${project.key} · ${project.name}`}
        </DialogDescription>
      </DialogHeader>
      <ProjectForm
        onDone={() => {
          onOpenChange(false);
        }}
        project={project}
        slug={slug}
      />
    </DialogContent>
  </Dialog>
);
