import type {
  SuggestionKeyDownProps,
  SuggestionOptions,
  SuggestionProps,
} from "@tiptap/suggestion";
import { cn } from "cn";
import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

interface MenuState<Item> {
  command: (item: Item) => void;
  element: HTMLElement;
  items: Item[];
}

export const useSuggestionMenu = <Item,>() => {
  const [menu, setMenu] = useState<MenuState<Item> | null>(null);
  const [selected, setSelected] = useState(0);
  const live = useRef({ menu, selected });

  useLayoutEffect(() => {
    live.current = { menu, selected };
  });

  const show = (props: SuggestionProps<Item, Item>, element?: HTMLElement) => {
    setMenu((current) => ({
      command: props.command,
      element: element ?? current?.element ?? document.createElement("div"),
      items: props.items,
    }));
    setSelected(0);
  };

  const onKeyDown = ({ event }: SuggestionKeyDownProps) => {
    const current = live.current.menu;
    const count = current?.items.length ?? 0;

    if (current === null || count === 0) {
      return false;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const step = event.key === "ArrowDown" ? 1 : count - 1;

      setSelected((index) => (index + step) % count);

      return true;
    }

    if (event.key === "Enter" || event.key === "Tab") {
      const item = current.items[live.current.selected];

      if (item !== undefined) {
        current.command(item);
      }

      return true;
    }

    return false;
  };

  const render: NonNullable<SuggestionOptions<Item, Item>["render"]> = () => {
    let unmount: (() => void) | null = null;

    return {
      onExit: () => {
        unmount?.();
        setMenu(null);
      },
      onKeyDown,
      onStart: (props) => {
        const element = document.createElement("div");

        element.className = "z-50";
        unmount = props.mount(element);
        show(props, element);
      },
      onUpdate: (props) => {
        show(props);
      },
    };
  };

  return {
    isOpen: () => live.current.menu !== null,
    menu,
    render,
    selected,
  };
};

export const SuggestionList = <Item,>({
  children,
  className,
  empty = "No results",
  groupOf,
  heading,
  keyOf,
  label,
  menu,
  selected,
}: {
  children: (item: Item) => ReactNode;
  className?: string;
  empty?: string;
  groupOf: (item: Item) => string;
  heading?: (group: string) => string;
  keyOf: (item: Item) => string;
  label: string;
  menu: MenuState<Item>;
  selected: number;
}) => (
  <>
    {createPortal(
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- A press inside the menu must not take focus from the editor, which drives the list.
      <section
        aria-label={label}
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The list scrolls, so keyboard users need to reach it; the editor keeps focus while typing.
        tabIndex={0}
        className={cn(
          "bg-popover text-popover-foreground ring-foreground/10 animate-in fade-in-0 zoom-in-98 z-50 flex max-h-80 flex-col overflow-y-auto rounded-lg p-1 shadow-md ring-1 duration-120",
          className
        )}
      >
        {menu.items.length === 0 ? (
          <span className="text-muted-foreground px-2 py-1.5">{empty}</span>
        ) : (
          menu.items.map((item, index) => {
            const group = groupOf(item);
            const previous = menu.items[index - 1];

            const first = previous === undefined || groupOf(previous) !== group;

            return (
              <div className="contents" key={keyOf(item)}>
                {first && previous !== undefined ? (
                  <div className="bg-border -mx-1 my-1 h-px shrink-0" />
                ) : null}
                {first && heading !== undefined ? (
                  <div className="text-muted-foreground px-2 pt-1 pb-1.5 text-xs">
                    {heading(group)}
                  </div>
                ) : null}
                <button
                  className="data-selected:bg-accent [&_svg:not([data-color])]:text-muted-foreground flex h-8 shrink-0 items-center gap-2 rounded-md px-2 text-left outline-none [&_svg]:size-4"
                  data-selected={index === selected}
                  onClick={() => {
                    menu.command(item);
                  }}
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  ref={
                    index === selected
                      ? (element) => {
                          element?.scrollIntoView({ block: "nearest" });
                        }
                      : undefined
                  }
                  tabIndex={-1}
                  type="button"
                >
                  {children(item)}
                </button>
              </div>
            );
          })
        )}
      </section>,
      menu.element
    )}
  </>
);
