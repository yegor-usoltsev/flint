const moveMs = 320;

const rowOf = (id: string) =>
  document.querySelector<HTMLElement>(`[data-issue="${CSS.escape(id)}"]`);

const moved = (from: DOMRect, to: DOMRect) =>
  Math.abs(from.left - to.left) >= 1 || Math.abs(from.top - to.top) >= 1;

const onScreen = (rect: DOMRect) =>
  rect.bottom > 0 &&
  rect.top < window.innerHeight &&
  rect.right > 0 &&
  rect.left < window.innerWidth;

export const rowRects = () =>
  new Map(
    [...document.querySelectorAll<HTMLElement>("[data-issue]")]
      .toReversed()
      .flatMap((row): [string, DOMRect][] => {
        const id = row.dataset["issue"];

        return id === undefined ? [] : [[id, row.getBoundingClientRect()]];
      })
  );

const worthAnimating = (from: DOMRect, to: DOMRect) =>
  moved(from, to) && (onScreen(from) || onScreen(to));

const play = (before: Map<string, DOMRect>) => {
  for (const [id, from] of before) {
    const row = rowOf(id);
    const to = row?.getBoundingClientRect();

    if (row !== null && to !== undefined && worthAnimating(from, to)) {
      row.animate(
        [
          {
            transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)`,
          },
          { transform: "none" },
        ],
        { duration: moveMs, easing: "cubic-bezier(0.2, 0, 0, 1)" }
      );
    }
  }
};

export const animateMoves = (before: Map<string, DOMRect>) => {
  if (
    before.size === 0 ||
    matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return;
  }

  setTimeout(() => {
    requestAnimationFrame(() => {
      play(before);
    });
  }, 0);
};
