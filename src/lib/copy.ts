import { toast } from "~/components/ui/toast";
import type { IssueSummary } from "~/lib/api-types";
import { branchName } from "~/lib/branch";

const copyWithSelection = (text: string, html?: string) => {
  const area = document.createElement("textarea");

  const onCopy = (event: ClipboardEvent) => {
    if (html !== undefined && event.clipboardData !== null) {
      event.preventDefault();
      event.clipboardData.setData("text/plain", text);
      event.clipboardData.setData("text/html", html);
    }
  };

  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  document.addEventListener("copy", onCopy);

  // oxlint-disable-next-line typescript/no-deprecated -- Plain-http origins have no navigator.clipboard, and only a copy event can add HTML synchronously.
  const copied = document.execCommand("copy");

  document.removeEventListener("copy", onCopy);
  area.remove();

  return copied;
};

const writeClipboard = async (text: string, html?: string) => {
  if (html === undefined) {
    try {
      await navigator.clipboard.writeText(text);

      return true;
    } catch {
      return copyWithSelection(text);
    }
  }

  return copyWithSelection(text, html);
};

export const copyText = async (text: string, what: string, html?: string) => {
  toast.add(
    (await writeClipboard(text, html))
      ? { description: text, title: `Copied the ${what}` }
      : { description: text, title: `Copy the ${what} manually` }
  );
};

export const copySecret = async (text: string) => {
  toast.add(
    (await writeClipboard(text))
      ? { title: "Copied" }
      : { description: "Select it and copy it manually", title: "Not copied" }
  );
};

export type IssueCopy = "branch" | "id" | "link" | "title" | "url";

const copyNames = {
  branch: ["git branch name", "git branch names"],
  id: ["issue ID", "issue IDs"],
  link: ["title as link", "titles as links"],
  title: ["issue title", "issue titles"],
  url: ["issue URL", "issue URLs"],
} satisfies Record<IssueCopy, [string, string]>;

const escapeHtml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export const issueUrl = (slug: string, key: string) =>
  new URL(`/${slug}/issue/${key}`, window.location.origin).href;

export const copyIssues = (
  issues: IssueSummary[],
  what: IssueCopy,
  slug: string,
  username: string
) => {
  const lines = issues.map((issue) => {
    const url = issueUrl(slug, issue.key);

    return {
      branch: branchName(username, issue.key, issue.title),
      id: issue.key,
      link: `[${issue.title}](${url})`,
      title: issue.title,
      url,
    }[what];
  });

  const html =
    what === "link"
      ? issues
          .map(
            (issue) =>
              `<a href="${escapeHtml(issueUrl(slug, issue.key))}">${escapeHtml(issue.title)}</a>`
          )
          .join("<br>")
      : undefined;

  void copyText(
    lines.join("\n"),
    copyNames[what][issues.length === 1 ? 0 : 1],
    html
  );
};
