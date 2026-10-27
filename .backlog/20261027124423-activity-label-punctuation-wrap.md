# Keep Activity punctuation with the preceding label

On a 393 px issue page, add and remove several labels including `Long label with several words wrapping`, followed by `Performance`. A comma after the long label can appear at the start of the next line. This happens before and after the FLN-4 baseline fix and was confirmed in Firefox 158 on macOS.

`joinClauses` in `src/components/issue-timeline.tsx` renders separators as separate text after each atomic inline-flex label. A line break is allowed between the label and its comma.

Open decision: keep punctuation with the preceding label while preserving normal wrapping of long names and the sentence. This is separate from FLN-4's baseline correction.
