import { isMac } from "~/lib/use-hotkey";

const symbols = new Map([
  ["Alt", ["⌥", "Alt"]],
  ["ArrowDown", ["↓", "↓"]],
  ["ArrowLeft", ["←", "←"]],
  ["ArrowRight", ["→", "→"]],
  ["ArrowUp", ["↑", "↑"]],
  ["Mod", ["⌘", "Ctrl"]],
  ["Shift", ["⇧", "Shift"]],
]);

export const keyLabel = (keys: string) => {
  const mac = isMac();

  return keys
    .split(/-(?!$)/u)
    .map((key) => symbols.get(key)?.[mac ? 0 : 1] ?? key.toUpperCase())
    .join(mac ? " " : "+");
};
