import { useState } from "react";

import { ApiError } from "~/lib/api";

export const textToSave = (draft: string | null, value: string) => {
  const text = draft?.trim() ?? "";

  return text === "" || text === value ? null : text;
};

export const afterSave = (current: string | null, saved: string) =>
  current === null || current.trim() === saved ? null : current;

export const rejection = (error: ApiError) =>
  error.status === 400 || error.status === 409 ? error.message : null;

export const useAutosaveText = (
  value: string,
  save: (text: string) => Promise<void>,
  validate: (text: string) => string | null = () => null
) => {
  const [draft, setDraft] = useState<string | null>(null);
  const [status, setStatus] = useState<"error" | "idle" | "saving">("idle");
  const [problem, setProblem] = useState<string | null>(null);

  const flush = async () => {
    if (status === "saving") {
      return;
    }

    const text = textToSave(draft, value);

    if (text === null) {
      setDraft(null);
      setStatus("idle");
      setProblem(null);

      return;
    }

    const invalid = validate(text);

    if (invalid !== null) {
      setStatus("error");
      setProblem(invalid);

      return;
    }

    setStatus("saving");
    setProblem(null);

    try {
      await save(text);
      setDraft((current) => afterSave(current, text));
      setStatus("idle");
    } catch (error) {
      setStatus("error");
      setProblem(error instanceof ApiError ? rejection(error) : null);
    }
  };

  const revert = () => {
    if (status === "saving") {
      return;
    }

    setDraft(null);
    setStatus("idle");
    setProblem(null);
  };

  return {
    edit: setDraft,
    flush,
    problem,
    revert,
    status,
    text: draft ?? value,
  };
};
