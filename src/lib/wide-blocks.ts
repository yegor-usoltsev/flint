import { rootRem } from "~/lib/rem";

const wideMaxRem = 80;
const gutterRem = 1;
const railGapRem = 2;

export const wideExtra = ({
  left,
  max,
  right,
  text,
}: {
  left: number;
  max: number;
  right: number;
  text: number;
}) => Math.floor(Math.max(0, Math.min(max - text, 2 * Math.min(left, right))));

export const fitWideBlocks = (
  scroller: HTMLElement,
  body: HTMLElement,
  rail: Element | null
) => {
  const rem = rootRem();
  const box = scroller.getBoundingClientRect();
  const text = body.getBoundingClientRect();
  const start = box.left + scroller.clientLeft + gutterRem * rem;

  const end =
    rail === null
      ? box.left + scroller.clientLeft + scroller.clientWidth - gutterRem * rem
      : rail.getBoundingClientRect().left - railGapRem * rem;

  const extra = wideExtra({
    left: text.left - start,
    max: wideMaxRem * rem,
    right: end - text.right,
    text: text.width,
  });

  body.style.setProperty("--wide-extra", `${extra}px`);
  body.style.setProperty("--wide-text", `${text.width}px`);
};
