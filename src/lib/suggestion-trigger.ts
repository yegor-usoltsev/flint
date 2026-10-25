import type { Range } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";

// Tiptap compares only listed characters, so allowTrigger checks the prefix itself.
export const allowedPrefixes = null;

// A menu opens at the start of a line, after whitespace or after an inline node such as a hard break, never inside a word or a URL.
const afterWhitespace = (state: EditorState, from: number) => {
  const before = state.doc.resolve(from).nodeBefore;

  return before?.isText !== true || /\s$/u.test(before.text ?? "");
};

// A trigger character inside code or a link is part of that text, not a command.
export const allowTrigger = ({
  range,
  state,
}: {
  range: Range;
  state: EditorState;
}) => {
  const $from = state.doc.resolve(range.from);
  const marks = state.doc.nodeAt(range.from)?.marks ?? [];

  return (
    afterWhitespace(state, range.from) &&
    $from.parent.type.spec.code !== true &&
    !marks.some(
      (mark) => mark.type.spec.code === true || mark.type.name === "link"
    )
  );
};
