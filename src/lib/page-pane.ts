import { createContext } from "react";

export const PagePane = createContext<"detail" | "list" | null>(null);

export const twoPaneQuery = "(min-width: 80rem)";
