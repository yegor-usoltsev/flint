export interface Reader {
  draft: string;
  endInView: boolean;
  focused: boolean;
}

interface Authored {
  author: { id: string };
  id: string;
}

export const holdsComments = ({ draft, endInView, focused }: Reader) =>
  focused || draft.trim() !== "" || !endInView;

export const seenIds = ({
  comments,
  known,
  me,
  reader,
}: {
  comments: Authored[];
  known: ReadonlySet<string> | null;
  me: string | undefined;
  reader: () => Reader;
}): ReadonlySet<string> => {
  const all = new Set(comments.map((comment) => comment.id));

  if (known === null) {
    return all;
  }

  const fresh = comments.filter((comment) => !known.has(comment.id));

  return fresh.length === 0 ||
    fresh.some((comment) => comment.author.id === me) ||
    !holdsComments(reader())
    ? all
    : known;
};

export const followsEnd = (gap: number, reader: Reader) =>
  gap <= 48 && !holdsComments(reader);
