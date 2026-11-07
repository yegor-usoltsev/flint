export const rootRem = () =>
  typeof getComputedStyle === "undefined"
    ? 16
    : Number(
        getComputedStyle(document.documentElement).fontSize.replace(/px$/u, "")
      ) || 16;
