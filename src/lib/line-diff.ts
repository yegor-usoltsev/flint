const maxCells = 4_000_000;

const commonPrefix = (a: string[], b: string[]) => {
  let index = 0;

  while (index < a.length && index < b.length && a[index] === b[index]) {
    index += 1;
  }

  return index;
};

const lcsTable = (a: string[], b: string[]) => {
  const table = Array.from({ length: a.length + 1 }, () =>
    Array.from({ length: b.length + 1 }, () => 0)
  );

  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      const row = table[i] ?? [];

      row[j] =
        a[i] === b[j]
          ? (table[i + 1]?.[j + 1] ?? 0) + 1
          : Math.max(table[i + 1]?.[j] ?? 0, row[j + 1] ?? 0);
    }
  }

  return table;
};

export type Change = "added" | "removed" | "same";

export interface DiffPart {
  change: Change;
  text: string;
}

const same = (parts: string[]) =>
  parts.map((text): DiffPart => ({ change: "same", text }));

export const diff = (before: string[], after: string[]) => {
  const start = commonPrefix(before, after);

  const end = commonPrefix(
    before.slice(start).toReversed(),
    after.slice(start).toReversed()
  );

  const a = before.slice(start, before.length - end);
  const b = after.slice(start, after.length - end);
  const parts = same(before.slice(0, start));

  const removed = (text = "") => {
    parts.push({ change: "removed", text });
  };

  const added = (text = "") => {
    parts.push({ change: "added", text });
  };

  if (a.length * b.length > maxCells) {
    for (const text of a) {
      removed(text);
    }

    for (const text of b) {
      added(text);
    }
  } else {
    const table = lcsTable(a, b);
    let i = 0;
    let j = 0;

    const dropsBefore = (row: number, column: number) => {
      const below = table[row + 1]?.[column] ?? 0;
      const right = table[row]?.[column + 1] ?? 0;

      return column >= b.length || (row < a.length && below >= right);
    };

    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) {
        parts.push({ change: "same", text: a[i] ?? "" });
        i += 1;
        j += 1;
      } else if (dropsBefore(i, j)) {
        removed(a[i]);
        i += 1;
      } else {
        added(b[j]);
        j += 1;
      }
    }
  }

  return [...parts, ...same(before.slice(before.length - end))];
};

export const changedLines = (mine: string, theirs: string) => {
  const changed = { mine: new Set<number>(), theirs: new Set<number>() };
  let i = 0;
  let j = 0;

  for (const { change } of diff(mine.split("\n"), theirs.split("\n"))) {
    if (change !== "added") {
      if (change === "removed") {
        changed.mine.add(i);
      }

      i += 1;
    }

    if (change !== "removed") {
      if (change === "added") {
        changed.theirs.add(j);
      }

      j += 1;
    }
  }

  return changed;
};

const words = (line: string) => line.split(/(?<space>\s+)/u).filter(Boolean);

export const wordDiff = (before: string, after: string) => {
  const merged: DiffPart[] = [];

  for (const part of diff(words(before), words(after))) {
    const last = merged.at(-1);

    if (last?.change === part.change) {
      last.text += part.text;
    } else {
      merged.push({ ...part });
    }
  }

  return merged;
};
