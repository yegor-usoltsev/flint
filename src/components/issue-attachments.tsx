import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { DownloadIcon, FileIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { AttachButton } from "~/components/markdown-editor";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { api } from "~/lib/api";
import type { Attachment, Issue } from "~/lib/api-types";
import { newId } from "~/lib/ids";
import { formatRelative } from "~/lib/issue-view";
import { notifyError } from "~/lib/notify";
import { formatBytes, isInlineImage, uploadFile } from "~/lib/uploads";

interface Upload {
  id: string;
  name: string;
  progress: number;
}

const Preview = ({ attachment }: { attachment: Attachment }) => {
  if (isInlineImage(attachment)) {
    return (
      <img
        alt=""
        className="bg-muted size-8 shrink-0 rounded-md border object-cover"
        loading="lazy"
        src={attachment.url}
      />
    );
  }

  return (
    <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md border">
      <FileIcon aria-hidden className="size-4" />
    </span>
  );
};

const actionClass =
  "text-muted-foreground hover:text-foreground focus-visible:ring-ring flex size-7 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-2 md:opacity-0 md:group-hover/attachment:opacity-100 md:focus-visible:opacity-100 [&_svg]:size-3.5";

const useAttachments = (ownerId: string, path: string) => {
  const queryClient = useQueryClient();
  const queryKey = ["attachments", ownerId];
  const [uploads, setUploads] = useState<Upload[]>([]);

  const list = useQuery({
    queryFn: async () => await api<Attachment[]>(path),
    queryKey,
  });

  const remove = useMutation({
    mutationFn: async (attachment: Attachment) => {
      await api(`/attachments/${attachment.id}`, { method: "DELETE" });
    },
    onError: notifyError("Could not delete the attachment"),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey });
    },
  });

  const setProgress = (id: string, progress: number) => {
    setUploads((current) =>
      current.map((item) => (item.id === id ? { ...item, progress } : item))
    );
  };

  const uploadOne = async (file: File) => {
    const id = newId();

    setUploads((current) => [...current, { id, name: file.name, progress: 0 }]);

    try {
      await uploadFile(path, file, (progress) => {
        setProgress(id, progress);
      });
      await queryClient.invalidateQueries({ queryKey });
    } catch (error) {
      notifyError(`Could not upload ${file.name}`)(
        error instanceof Error ? error : new Error(String(error))
      );
    }

    setUploads((current) => current.filter((item) => item.id !== id));
  };

  return {
    attachments: list.data ?? [],
    failed: list.isError,
    loaded: list.data !== undefined,
    remove: remove.mutate,
    retry: () => {
      void list.refetch();
    },
    upload: (files: File[]) => {
      for (const file of files) {
        void uploadOne(file);
      }
    },
    uploads,
  };
};

export const AttachmentList = ({
  body,
  editable,
  hint,
  id,
  path,
}: {
  body?: string;
  editable: boolean;
  hint: string;
  id: string;
  path: string;
}) => {
  const { attachments, failed, loaded, remove, retry, upload, uploads } =
    useAttachments(id, path);

  const [deleting, setDeleting] = useState<Attachment | null>(null);

  if (!editable && !failed && attachments.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="attachments-heading" className="flex flex-col">
      <header className="flex h-7 items-center gap-2">
        <h2
          className="text-muted-foreground font-medium"
          id="attachments-heading"
        >
          Attachments
        </h2>
        {attachments.length > 0 ? (
          <span className="text-muted-foreground text-xs tabular-nums">
            {attachments.length}
          </span>
        ) : null}
        {editable ? (
          <span className="ml-auto">
            <AttachButton onFiles={upload} />
          </span>
        ) : null}
      </header>
      {failed ? (
        <p className="text-destructive flex items-center gap-2 text-xs">
          {loaded
            ? "Could not refresh attachments."
            : "Attachments could not load."}
          <Button onClick={retry} size="xs" variant="outline">
            Retry
          </Button>
        </p>
      ) : null}
      {loaded && attachments.length === 0 && uploads.length === 0 ? (
        <p className="text-muted-foreground text-xs">{hint}</p>
      ) : null}
      <ul className="flex flex-col">
        {attachments.map((attachment) => (
          <li
            className="group/attachment hover:bg-accent/60 -mx-2 flex min-h-11 items-center gap-2.5 rounded-md px-2 py-1"
            key={attachment.id}
          >
            <Preview attachment={attachment} />
            <span className="flex min-w-0 flex-1 flex-col">
              <a
                className="truncate hover:underline"
                href={attachment.url}
                rel="noopener noreferrer"
                target="_blank"
              >
                {attachment.filename}
              </a>
              <span className="text-muted-foreground truncate text-xs">
                {formatBytes(attachment.size)} ·{" "}
                {attachment.uploader.displayName} ·{" "}
                {formatRelative(attachment.createdAt)}
              </span>
            </span>
            <a
              aria-label={`Download ${attachment.filename}`}
              className={actionClass}
              download={attachment.filename}
              href={attachment.url}
            >
              <DownloadIcon />
            </a>
            {editable ? (
              <button
                aria-label={`Delete ${attachment.filename}`}
                className={cn(actionClass, "hover:text-destructive")}
                onClick={() => {
                  setDeleting(attachment);
                }}
                type="button"
              >
                <Trash2Icon />
              </button>
            ) : null}
          </li>
        ))}
        {uploads.map((item) => (
          <li
            className="flex min-h-11 flex-col justify-center gap-1.5"
            key={item.id}
          >
            <span className="text-muted-foreground truncate text-xs">
              Uploading {item.name}
            </span>
            <span className="bg-muted h-1 overflow-hidden rounded-full">
              <span
                className="bg-primary block h-full origin-left scale-x-(--progress) rounded-full transition-transform duration-150"
                style={{ "--progress": item.progress }}
              />
            </span>
          </li>
        ))}
      </ul>
      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            setDeleting(null);
          }
        }}
        open={deleting !== null}
      >
        <AlertDialogContent className="wrap-anywhere">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.filename}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting !== null && body?.includes(deleting.url) === true
                ? "The file is removed for everyone. This page links to it, and those links will stop working."
                : "The file is removed for everyone, and links to it stop working."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleting !== null) {
                  remove(deleting);
                }

                setDeleting(null);
              }}
              variant="destructive"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};

export const IssueAttachments = ({
  editable,
  issue,
}: {
  editable: boolean;
  issue: Issue;
}) => (
  <AttachmentList
    editable={editable}
    hint="Paste or drop files into the description, or attach them here."
    id={issue.id}
    path={`/issues/${issue.key}/attachments`}
  />
);
