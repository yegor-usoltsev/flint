const fencePattern = /^ {0,3}(?<fence>`{3,}|~{3,})/u;
const taskPattern = /^\s*(?:[-*+]|\d+[.)])\s+\[(?<mark>[ xX])\]/u;

export interface ChecklistItem {
  done: boolean;
  number: number;
  text: string;
}

const checklistLines = (lines: string[]) => {
  const items: (ChecklistItem & { line: number; prefix: string })[] = [];
  let fence = "";

  for (const [line, text] of lines.entries()) {
    const opening = fencePattern.exec(text);
    const marker = opening?.groups?.["fence"];

    if (fence !== "") {
      const closes =
        marker?.startsWith(fence) === true &&
        text.slice(opening?.[0].length).trim() === "";

      fence = closes ? "" : fence;
    } else if (marker === undefined) {
      const match = taskPattern.exec(text);

      if (match !== null) {
        items.push({
          done: match.groups?.["mark"] !== " ",
          line,
          number: items.length + 1,
          prefix: match[0],
          text: text.slice(match[0].length).trim(),
        });
      }
    } else {
      fence = marker;
    }
  }

  return items;
};

export const countChecklist = (markdown: string) => {
  const items = checklistLines(markdown.split("\n"));

  return {
    done: items.filter((item) => item.done).length,
    total: items.length,
  };
};

export const setChecklistItem = (
  markdown: string,
  item: string,
  done: boolean
): { markdown: string } | { matches: ChecklistItem[] } => {
  const lines = markdown.split("\n");
  const items = checklistLines(lines);
  const wanted = /^\d+$/u.test(item) ? Number(item) : undefined;

  const matches = items.filter((candidate) =>
    wanted === undefined
      ? candidate.text.toLowerCase().includes(item.toLowerCase())
      : candidate.number === wanted
  );

  const open = matches.filter((candidate) => candidate.done !== done);
  const [target] = matches.length === 1 ? matches : open;

  if (target === undefined || (matches.length > 1 && open.length !== 1)) {
    return {
      matches: matches.map(({ done: ticked, number, text }) => ({
        done: ticked,
        number,
        text,
      })),
    };
  }

  lines[target.line] =
    `${target.prefix.slice(0, -2)}${done ? "x" : " "}]${lines[target.line]?.slice(target.prefix.length) ?? ""}`;

  return { markdown: lines.join("\n") };
};
