import { useSyncExternalStore } from "react";

import type { IssueSummary } from "~/lib/api-types";
import { readStoredText, setStoredText } from "~/lib/use-draft";

export type Properties = Pick<
  IssueSummary,
  "assigneeId" | "labelIds" | "priority" | "statusId"
>;

export interface DraftText {
  description: string;
  title: string;
}

export interface Submitted {
  projectKey: string;
  properties: Properties;
  text: DraftText;
}

export const emptyText: DraftText = { description: "", title: "" };

export const titleLimit = 500;

const fields = ["description", "title"] as const;

export const savedProperties = new Map<string, Properties>();

const errors = new Map<string, string>();
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) {
    listener();
  }
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};

export const draftKey = (projectKey: string, field: keyof DraftText) =>
  `new-issue:${projectKey}:${field}`;

export const readDraft = (projectKey: string): DraftText => ({
  description: readStoredText(draftKey(projectKey, "description")) ?? "",
  title: readStoredText(draftKey(projectKey, "title")) ?? "",
});

export const writeDraft = (projectKey: string, text: DraftText) => {
  for (const field of fields) {
    setStoredText(
      draftKey(projectKey, field),
      text[field] === "" ? null : text[field]
    );
  }
};

export const createError = (projectKey: string) =>
  errors.get(projectKey) ?? null;

export const setCreateError = (projectKey: string, message: string | null) => {
  if (message === null) {
    errors.delete(projectKey);
  } else {
    errors.set(projectKey, message);
  }

  emit();
};

export const useCreateError = (projectKey: string) =>
  useSyncExternalStore(
    subscribe,
    () => createError(projectKey),
    () => null
  );

const propertyText = ({
  assigneeId,
  labelIds,
  priority,
  statusId,
}: Properties) => JSON.stringify([assigneeId, labelIds, priority, statusId]);

const sameProperties = (a: Properties | undefined, b: Properties) =>
  a !== undefined && propertyText(a) === propertyText(b);

export const settleSubmitted = ({
  projectKey,
  properties,
  text,
}: Submitted) => {
  const current = readDraft(projectKey);

  writeDraft(projectKey, {
    description:
      current.description === text.description ? "" : current.description,
    title: current.title === text.title ? "" : current.title,
  });

  if (sameProperties(savedProperties.get(projectKey), properties)) {
    savedProperties.delete(projectKey);
  }

  setCreateError(projectKey, null);
};

export const restoreSubmitted = (
  { projectKey, properties, text }: Submitted,
  error: string | null
) => {
  const current = readDraft(projectKey);

  if (current.title === "" && current.description === "") {
    writeDraft(projectKey, text);

    if (!savedProperties.has(projectKey)) {
      savedProperties.set(projectKey, properties);
    }
  }

  setCreateError(projectKey, error);
};
