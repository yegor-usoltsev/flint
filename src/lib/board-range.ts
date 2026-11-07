export interface ColumnRange {
  count: number;
  first: number;
  last: number;
}

export const visibleRange = (
  ids: string[],
  visible: ReadonlySet<string>
): ColumnRange | null => {
  const first = ids.findIndex((id) => visible.has(id));

  if (first === -1) {
    return null;
  }

  const last = ids.findLastIndex((id) => visible.has(id));

  return { count: ids.length, first: first + 1, last: last + 1 };
};

export const rangeLabel = ({ count, first, last }: ColumnRange) =>
  first === last ? `${first} of ${count}` : `${first}–${last} of ${count}`;
