import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { cn } from "cn";
import { ChevronLeftIcon, CopyIcon } from "lucide-react";
import { useState } from "react";
import type { SubmitEvent } from "react";

import {
  backLink,
  SettingsPage,
  SettingsSection,
} from "~/components/settings-page";
import { Button, buttonVariants } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Field, FieldError, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { WorkspaceLogo } from "~/components/workspace-logo";
import { request, useMe } from "~/lib/api";
import type { CreatedApiToken } from "~/lib/api-types";
import { copySecret } from "~/lib/copy";
import { tokensQuery } from "~/lib/queries";
import { pageHead } from "~/lib/site";
import { useWorkspace } from "~/lib/use-workspace";

const CreatedKey = ({
  slug,
  token,
}: {
  slug: string;
  token: CreatedApiToken;
}) => (
  <div className="flex flex-col gap-4 py-4">
    <div className="flex flex-col gap-1">
      <h2 className="font-medium">Copy “{token.name}” now</h2>
      <p className="text-muted-foreground">
        Flint shows this key only once. Pass it to{" "}
        <code className="font-mono">flint login</code> or send it as a bearer
        token.
      </p>
    </div>
    <div className="flex gap-2">
      <Input
        aria-label="New API key"
        onFocus={(event) => {
          event.target.select();
        }}
        readOnly
        value={token.token}
      />
      <Button
        onClick={() => {
          void copySecret(token.token);
        }}
        variant="outline"
      >
        <CopyIcon data-icon="inline-start" />
        Copy
      </Button>
    </div>
    <Link
      className={cn(buttonVariants(), "self-end")}
      params={{ slug }}
      to="/$slug/settings/account/api-keys"
    >
      Done
    </Link>
  </div>
);

const NewApiKey = () => {
  const queryClient = useQueryClient();
  const workspace = useWorkspace();
  const { data: me } = useMe();
  const workspaces = me?.workspaces ?? [];
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"all" | "selected">("all");
  const [selected, setSelected] = useState(() => new Set([workspace.slug]));
  const chosen = workspaces.filter((item) => selected.has(item.slug));
  const missing = scope === "selected" && chosen.length === 0;

  const create = useMutation({
    mutationFn: async () =>
      await request("POST /me/tokens", {
        body:
          scope === "all"
            ? { name }
            : { name, workspaces: chosen.map((item) => item.slug) },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: tokensQuery.queryKey });
    },
  });

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!create.isPending && !missing) {
      create.mutate();
    }
  };

  return (
    <SettingsPage
      back={
        <Link
          className={backLink}
          params={{ slug: workspace.slug }}
          to="/$slug/settings/account/api-keys"
        >
          <ChevronLeftIcon aria-hidden className="size-4" />
          API keys
        </Link>
      }
      description="Everything done with the key is attributed to you."
      title="Create API key"
    >
      <SettingsSection>
        {create.data === undefined ? (
          <form
            aria-busy={create.isPending}
            className="flex flex-col gap-6 py-4"
            onSubmit={submit}
          >
            <fieldset
              className="flex flex-col gap-6"
              disabled={create.isPending}
            >
              <Field>
                <FieldLabel htmlFor="key-name">Key name</FieldLabel>
                <Input
                  autoComplete="off"
                  autoFocus
                  id="key-name"
                  maxLength={100}
                  onChange={(event) => {
                    setName(event.target.value);

                    if (create.isError) {
                      create.reset();
                    }
                  }}
                  placeholder="A descriptive name, such as Work laptop"
                  required
                  value={name}
                />
              </Field>
              <fieldset className="flex flex-col gap-3">
                <legend className="mb-1 flex flex-col gap-0.5">
                  <span className="font-medium">Workspace access</span>
                  <span className="text-muted-foreground">
                    Limit the workspaces the key can reach
                  </span>
                </legend>
                <RadioGroup
                  onValueChange={(value) => {
                    setScope(value === "selected" ? "selected" : "all");
                  }}
                  value={scope}
                >
                  {/* oxlint-disable-next-line jsx-a11y/label-has-associated-control -- RadioGroupItem renders the radio inside this label. */}
                  <label className="flex items-center gap-2">
                    <RadioGroupItem value="all" />
                    All workspaces you have access to
                  </label>
                  {/* oxlint-disable-next-line jsx-a11y/label-has-associated-control -- RadioGroupItem renders the radio inside this label. */}
                  <label className="flex items-center gap-2">
                    <RadioGroupItem value="selected" />
                    Only selected workspaces
                  </label>
                </RadioGroup>
                {scope === "selected" ? (
                  <ul
                    aria-label="Workspaces"
                    className="ml-6 flex flex-col rounded-lg border p-1"
                  >
                    {workspaces.map((item) => (
                      <li key={item.id}>
                        <label className="hover:bg-row-focus flex h-9 items-center gap-2.5 rounded-md px-2">
                          <Checkbox
                            checked={selected.has(item.slug)}
                            onCheckedChange={(checked) => {
                              const next = new Set(selected);

                              if (checked) {
                                next.add(item.slug);
                              } else {
                                next.delete(item.slug);
                              }

                              setSelected(next);
                            }}
                          />
                          <WorkspaceLogo workspace={item} />
                          <span className="truncate">{item.name}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {missing ? (
                  <p className="text-muted-foreground ml-6 text-xs">
                    Choose at least one workspace.
                  </p>
                ) : null}
              </fieldset>
              {create.isError ? (
                <FieldError>{create.error.message}</FieldError>
              ) : null}
            </fieldset>
            <div className="flex justify-end gap-2">
              <Link
                className={cn(buttonVariants({ variant: "ghost" }))}
                params={{ slug: workspace.slug }}
                to="/$slug/settings/account/api-keys"
              >
                Cancel
              </Link>
              <Button disabled={create.isPending || missing} type="submit">
                Create
              </Button>
            </div>
          </form>
        ) : (
          <CreatedKey slug={workspace.slug} token={create.data} />
        )}
      </SettingsSection>
    </SettingsPage>
  );
};

export const Route = createFileRoute("/$slug/settings/account/api-keys/new")({
  component: NewApiKey,
  head: () => pageHead("Create API key"),
});
