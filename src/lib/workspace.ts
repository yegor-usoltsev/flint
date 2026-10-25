import type { Me, Workspace } from "~/lib/api-types";

const storageKey = "workspace";

export const reservedSlugs = new Set([
  "admin",
  "api",
  "assets",
  "auth",
  "brand",
  "doc",
  "docs",
  "files",
  "help",
  "issue",
  "issues",
  "login",
  "logout",
  "new",
  "project",
  "projects",
  "settings",
  "signin",
  "signup",
  "static",
  "status",
  "w",
  "wiki",
]);

export const slugProblem = (slug: string) => {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) {
    return "Use lowercase letters, digits and single dashes";
  }

  return reservedSlugs.has(slug) ? `/${slug} is reserved by Flint` : null;
};

export const rememberWorkspace = (slug: string) => {
  localStorage.setItem(storageKey, slug);
};

export const lastWorkspace = () => localStorage.getItem(storageKey);

export const forgetWorkspace = (slug: string) => {
  if (lastWorkspace() === slug) {
    localStorage.removeItem(storageKey);
  }
};

export const withoutWorkspace = (me: Me | null | undefined, id: string) =>
  me
    ? { ...me, workspaces: me.workspaces.filter((item) => item.id !== id) }
    : me;

export const nextWorkspace = (
  workspaces: { slug: string }[],
  deleted: string,
  remembered: string | null
) => {
  const rest = workspaces.filter(({ slug }) => slug !== deleted);

  return (
    rest.find(({ slug }) => slug === remembered)?.slug ?? rest[0]?.slug ?? null
  );
};

type FollowedWorkspace =
  | { kind: "gone"; name: string }
  | { kind: "moved"; slug: string }
  | null;

export const followWorkspace = (
  seen: Pick<Workspace, "id" | "name" | "slug"> | null,
  slug: string,
  workspaces: Pick<Workspace, "id" | "slug">[]
): FollowedWorkspace => {
  if (seen?.slug !== slug) {
    return null;
  }

  const current = workspaces.find((item) => item.id === seen.id);

  if (current === undefined) {
    return { kind: "gone", name: seen.name };
  }

  return current.slug === slug ? null : { kind: "moved", slug: current.slug };
};

export const slugify = (name: string) =>
  name
    .normalize("NFKD")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-|-$/gu, "")
    .slice(0, 40);

export const suggestKey = (name: string) => {
  const words = name
    .normalize("NFKD")
    .toUpperCase()
    .replaceAll(/[^A-Z0-9 ]/gu, "")
    .split(" ")
    .filter(Boolean);

  const key =
    words.length > 1
      ? words.map((word) => word.charAt(0)).join("")
      : (words[0] ?? "").slice(0, 3);

  return key.replace(/^\d+/u, "").slice(0, 5);
};
