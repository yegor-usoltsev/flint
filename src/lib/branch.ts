export const branchName = (username: string, key: string, title: string) => {
  const slug = title
    .normalize("NFKD")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-|-$/gu, "");

  const short =
    slug.length > 50 ? slug.slice(0, 51).replace(/-[^-]*$/u, "") : slug;

  const name =
    short === "" ? key.toUpperCase() : `${key.toUpperCase()}-${short}`;

  return username === "" ? name : `${username}/${name}`;
};
