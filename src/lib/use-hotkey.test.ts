import { afterEach, expect, test } from "bun:test";

import { dispatch, hotkeyCaps, registerCommands } from "~/lib/use-hotkey";
import type { Command, KeyPress } from "~/lib/use-hotkey";

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

const register = (commands: Command[], fallback = false) => {
  cleanups.push(registerCommands({ commands, fallback }));
};

let time = 0;

const press = (
  key: string,
  {
    code = `Key${key.toUpperCase()}`,
    editable = false,
    mac = true,
    ...modifiers
  }: Partial<KeyPress> & { editable?: boolean; mac?: boolean } = {}
) => {
  let prevented = false;
  time += 10;

  dispatch(
    {
      altKey: false,
      code,
      ctrlKey: false,
      key,
      metaKey: false,
      preventDefault: () => {
        prevented = true;
      },
      repeat: false,
      shiftKey: false,
      timeStamp: time,
      ...modifiers,
    },
    { editable, mac }
  );

  return prevented;
};

const recorder = () => {
  const calls: string[] = [];

  return {
    calls,
    command: (id: string, keys: string, extra: Partial<Command> = {}) => ({
      hotkey: { keys },
      id,
      run: () => {
        calls.push(id);
      },
      ...extra,
    }),
  };
};

test("single keys run outside text fields and match the physical key", () => {
  const { calls, command } = recorder();
  register([command("create", "c")]);

  expect(press("c")).toBe(true);
  expect(press("с", { code: "KeyC" })).toBe(true);
  expect(press("c", { editable: true })).toBe(false);
  expect(press("c", { metaKey: true })).toBe(false);
  expect(press("C", { shiftKey: true })).toBe(false);
  expect(calls).toEqual(["create", "create"]);
});

test("a Latin letter matches what it types, not its physical key", () => {
  const { calls, command } = recorder();
  register([
    command("next", "j"),
    command("create", "c"),
    command("assign", "a"),
  ]);

  expect(press("j", { code: "KeyC" })).toBe(true);
  expect(press("q", { code: "KeyA" })).toBe(false);
  expect(press("о", { code: "KeyJ" })).toBe(true);
  expect(press("ю", { code: "Period", metaKey: true })).toBe(false);
  expect(calls).toEqual(["next", "next"]);
});

test("mod means Cmd on macOS and Ctrl elsewhere", () => {
  const { calls, command } = recorder();
  register([
    {
      ...command("palette", "k"),
      hotkey: { inInputs: true, keys: "k", mod: true },
    },
    {
      ...command("branch", "."),
      hotkey: { keys: ".", mod: true, shift: true },
    },
  ]);

  press("k", { metaKey: true });
  press("k", { ctrlKey: true, mac: false });
  press("k", { ctrlKey: true });
  press("k", { editable: true, metaKey: true });
  press(">", { code: "Period", metaKey: true, shiftKey: true });
  press(".", { code: "Period", editable: true, metaKey: true, shiftKey: true });

  expect(calls).toEqual(["palette", "palette", "palette", "branch"]);
});

test("shifted punctuation matches its unshifted physical key", () => {
  const { calls, command } = recorder();
  register([
    {
      ...command("copy-title", "'"),
      hotkey: { keys: "'", mod: true, shift: true },
    },
    {
      ...command("copy-link", ","),
      hotkey: { keys: ",", mod: true, shift: true },
    },
  ]);

  press('"', { code: "Quote", metaKey: true, shiftKey: true });
  press('"', { code: "Quote", ctrlKey: true, mac: false, shiftKey: true });
  press("<", { code: "Comma", metaKey: true, shiftKey: true });
  press("'", { code: "Quote", metaKey: true });

  expect(calls).toEqual(["copy-title", "copy-title", "copy-link"]);
});

test("question mark ignores shift and slash requires no shift", () => {
  const { calls, command } = recorder();
  register([command("help", "?"), command("search", "/")]);

  press("?", { code: "Slash", shiftKey: true });
  press("/", { code: "Slash" });
  press(".", { code: "Slash" });

  expect(calls).toEqual(["help", "search", "search"]);
});

test("a chord prefix waits for its second key and shadows single keys", () => {
  const { calls, command } = recorder();
  register([
    command("my-issues", "g m"),
    command("labels", "l"),
    command("list", "g l"),
  ]);

  expect(press("g")).toBe(false);
  press("m");
  press("l");
  press("g");
  press("l");
  press("g");
  press("x");
  press("m");

  expect(calls).toEqual(["my-issues", "labels", "list"]);
});

test("page commands win over fallbacks and a declined command passes", () => {
  const { calls, command } = recorder();
  let ready = false;

  register([command("global", "j"), command("delete", "x")], true);
  register([
    command("page", "j"),
    command("guarded", "x", { when: () => ready }),
  ]);

  press("j");
  press("x");
  ready = true;
  press("x");

  expect(calls).toEqual(["page", "delete", "guarded"]);
});

test("held keys repeat only for commands that allow it", () => {
  const { calls, command } = recorder();
  register([
    command("next", "j", { hotkey: { keys: "j", repeat: true } }),
    command("status", "s"),
  ]);

  press("j", { repeat: true });
  press("s", { repeat: true });

  expect(calls).toEqual(["next"]);
});

test("hotkeyCaps renders platform modifiers", () => {
  expect(hotkeyCaps({ keys: "g m" }, true)).toEqual(["G", "M"]);
  expect(hotkeyCaps({ keys: "backspace", mod: true }, true)).toEqual([
    "⌘",
    "⌫",
  ]);
  expect(hotkeyCaps({ keys: ".", mod: true, shift: true }, false)).toEqual([
    "Ctrl",
    "Shift",
    ".",
  ]);
});
