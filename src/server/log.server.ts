import { pino } from "pino";

export const log = pino({
  base: null,
  formatters: { level: (label) => ({ level: label }) },
  level: import.meta.env.DEV ? "debug" : "info",
  timestamp: pino.stdTimeFunctions.isoTime,
});
