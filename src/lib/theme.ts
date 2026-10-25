import { useSyncExternalStore } from "react";

export const themes = ["light", "dark", "system"] as const;

export type Theme = (typeof themes)[number];

export const themeItems = [
  { label: "System preference", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
] as const;

export const isTheme = (value: unknown): value is Theme =>
  themes.some((theme) => theme === value);

const storageKey = "theme";
const darkQuery = "(prefers-color-scheme: dark)";

export const themeColors = { dark: "#121316", light: "#f8f8f9" } as const;

export const themeScript = `{const t=localStorage.getItem("${storageKey}");document.documentElement.classList.toggle("dark",t==="dark"||(t!=="light"&&matchMedia("${darkQuery}").matches))}`;

export const readTheme = (): Theme => {
  const stored = localStorage.getItem(storageKey);

  return stored === "light" || stored === "dark" ? stored : "system";
};

export const applyTheme = () => {
  const theme = readTheme();
  document.documentElement.classList.toggle(
    "dark",
    theme === "dark" || (theme === "system" && matchMedia(darkQuery).matches)
  );
};

export const subscribeTheme = (onChange: () => void) => {
  const media = matchMedia(darkQuery);
  media.addEventListener("change", onChange);
  window.addEventListener("storage", onChange);

  return () => {
    media.removeEventListener("change", onChange);
    window.removeEventListener("storage", onChange);
  };
};

export const setTheme = (theme: Theme) => {
  if (theme === "system") {
    localStorage.removeItem(storageKey);
  } else {
    localStorage.setItem(storageKey, theme);
  }

  applyTheme();
  window.dispatchEvent(new StorageEvent("storage", { key: storageKey }));
};

export const useTheme = () =>
  useSyncExternalStore(subscribeTheme, readTheme, () => "system" as const);
