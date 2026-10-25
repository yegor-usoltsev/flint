import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { SubmitEvent } from "react";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { api, meQuery } from "~/lib/api";
import type { Workspace } from "~/lib/api-types";
import { reservedSlugs, slugify } from "~/lib/workspace";

export const WorkspaceForm = ({
  cta = false,
  onCreated,
}: {
  cta?: boolean;
  onCreated?: () => void;
}) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const effectiveSlug = slug ?? slugify(name);
  const reserved = reservedSlugs.has(effectiveSlug);

  const create = useMutation({
    mutationFn: async () =>
      await api<Workspace>("/workspaces", {
        body: { demo, name, slug: effectiveSlug },
        method: "POST",
      }),
    onSuccess: async (workspace) => {
      await queryClient.invalidateQueries({ queryKey: meQuery.queryKey });
      onCreated?.();
      await navigate({
        params: { slug: workspace.slug },
        to: "/$slug/my-issues",
      });
    },
  });

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <form className="flex flex-col gap-6" onSubmit={submit}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="workspace-name">Name</FieldLabel>
          <Input
            autoComplete="off"
            autoFocus
            id="workspace-name"
            maxLength={60}
            onChange={(event) => {
              setName(event.target.value);
            }}
            placeholder="Company or team name"
            required
            value={name}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="workspace-slug">URL</FieldLabel>
          <Input
            aria-describedby="workspace-slug-hint"
            aria-invalid={create.isError || reserved || undefined}
            autoComplete="off"
            id="workspace-slug"
            maxLength={40}
            onChange={(event) => {
              setSlug(event.target.value);
            }}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            placeholder="team-name"
            required
            value={effectiveSlug}
          />
          <FieldDescription id="workspace-slug-hint">
            Lowercase letters, digits and dashes.
          </FieldDescription>
          {reserved ? (
            <FieldError>/{effectiveSlug} is reserved by Flint.</FieldError>
          ) : null}
          {create.isError && !reserved ? (
            <FieldError>{create.error.message}</FieldError>
          ) : null}
        </Field>
        <Field orientation="horizontal">
          <Checkbox
            checked={demo}
            id="workspace-demo"
            onCheckedChange={setDemo}
          />
          <FieldContent>
            <FieldLabel htmlFor="workspace-demo">Include demo data</FieldLabel>
            <FieldDescription>
              A Getting started project and a wiki guide.
            </FieldDescription>
          </FieldContent>
        </Field>
      </FieldGroup>
      <div className="flex justify-end">
        <Button
          className={cta ? "w-full" : undefined}
          disabled={create.isPending || reserved}
          size={cta ? "cta" : "default"}
          type="submit"
        >
          Create workspace
        </Button>
      </div>
    </form>
  );
};

export const WorkspaceDialog = ({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) => (
  <Dialog onOpenChange={onOpenChange} open={open}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Create workspace</DialogTitle>
        <DialogDescription>
          You become its admin and can add members by Gitea username.
        </DialogDescription>
      </DialogHeader>
      <WorkspaceForm
        onCreated={() => {
          onOpenChange(false);
        }}
      />
    </DialogContent>
  </Dialog>
);
