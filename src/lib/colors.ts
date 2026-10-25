export const colors = [
  "gray",
  "red",
  "orange",
  "amber",
  "lime",
  "green",
  "teal",
  "cyan",
  "blue",
  "indigo",
  "purple",
  "pink",
] as const;

export type Color = (typeof colors)[number];

export const colorLabel = (color: Color) =>
  `${color.charAt(0).toUpperCase()}${color.slice(1)}`;

export const isColor = (value: unknown): value is Color =>
  colors.some((color) => color === value);
