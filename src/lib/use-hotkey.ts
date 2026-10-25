import { useEffect, useRef } from "react";

export interface Hotkey {
  inInputs?: boolean;
  keys: string;
  mod?: boolean;
  repeat?: boolean;
  shift?: boolean;
}

export interface Command {
  group?: string;
  hotkey?: Hotkey;
  id: string;
  keywords?: string;
  label?: string;
  run: () => void;
  when?: () => boolean;
}

export interface Entry {
  commands: Command[];
  fallback: boolean;
}

export interface KeyPress {
  altKey: boolean;
  code: string;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  preventDefault: () => void;
  repeat: boolean;
  shiftKey: boolean;
  timeStamp: number;
}

interface Press {
  editable: boolean;
  event: KeyPress;
  mac: boolean;
  prefix: string | null;
  pressed: Set<string>;
}

const entries = new Set<Entry>();
const chordTimeout = 1500;
let chord: { at: number; key: string } | null = null;

const codeKeys = new Map([
  ["BracketLeft", "["],
  ["Comma", ","],
  ["Period", "."],
  ["Quote", "'"],
  ["Slash", "/"],
]);

const shiftedKeys = new Set(["?"]);

const physicalKey = ({ code, key }: KeyPress) => {
  if (/^[a-z]$/iu.test(key)) {
    return null;
  }

  const letter = /^[\u0020-\u007E]$/u.test(key)
    ? undefined
    : /^(?:Key|Digit)(?<char>\w)$/u.exec(code)?.groups?.["char"]?.toLowerCase();

  return letter ?? codeKeys.get(code) ?? null;
};

const pressedKeys = (event: KeyPress) => {
  const keys = new Set([event.key.toLowerCase()]);
  const physical = physicalKey(event);

  if (physical !== null) {
    keys.add(physical);
  }

  return keys;
};

const splitKeys = (keys: string) => {
  const [first = "", second] = keys.split(" ");

  return second === undefined
    ? { key: first, prefix: null }
    : { key: second, prefix: first };
};

const modifiersMatch = (hotkey: Hotkey, key: string, { event, mac }: Press) => {
  const mod = mac ? event.metaKey : event.ctrlKey;
  const other = mac ? event.ctrlKey : event.metaKey;

  if (other || event.altKey || mod !== (hotkey.mod ?? false)) {
    return false;
  }

  return shiftedKeys.has(key) || event.shiftKey === (hotkey.shift ?? false);
};

const allowed = (hotkey: Hotkey, { editable, event }: Press) =>
  (!editable || hotkey.inInputs === true) &&
  (!event.repeat || hotkey.repeat === true);

const matches = (hotkey: Hotkey, press: Press) => {
  const { key, prefix } = splitKeys(hotkey.keys);

  return (
    prefix === press.prefix &&
    press.pressed.has(key) &&
    allowed(hotkey, press) &&
    modifiersMatch(hotkey, key, press)
  );
};

const ordered = () =>
  [...entries]
    .toReversed()
    .toSorted((a, b) => Number(a.fallback) - Number(b.fallback));

const findCommand = (press: Press) => {
  for (const entry of ordered()) {
    const command = entry.commands.find(
      ({ hotkey, when }) =>
        hotkey !== undefined &&
        matches(hotkey, press) &&
        (when === undefined || when())
    );

    if (command !== undefined) {
      return command;
    }
  }

  return null;
};

const chordStart = ({ editable, event, prefix, pressed }: Press) => {
  if (prefix !== null || editable || event.altKey) {
    return null;
  }

  if (event.ctrlKey || event.metaKey) {
    return null;
  }

  const prefixes = new Set(
    [...entries].flatMap((entry) =>
      entry.commands.flatMap(({ hotkey }) =>
        hotkey === undefined ? [] : [splitKeys(hotkey.keys).prefix]
      )
    )
  );

  return [...pressed].find((key) => prefixes.has(key)) ?? null;
};

export const dispatch = (
  event: KeyPress,
  { editable, mac }: { editable: boolean; mac: boolean }
) => {
  const fresh = chord !== null && event.timeStamp - chord.at < chordTimeout;

  const press: Press = {
    editable,
    event,
    mac,
    prefix: fresh ? (chord?.key ?? null) : null,
    pressed: pressedKeys(event),
  };

  chord = null;

  const command = findCommand(press);

  if (command !== null) {
    event.preventDefault();
    command.run();

    return;
  }

  const key = chordStart(press);

  if (key !== null) {
    chord = { at: event.timeStamp, key };
  }
};

export const isMac = () => /Mac|iPhone|iPad/u.test(navigator.userAgent);

export const isCoarsePointer = () =>
  window.matchMedia("(pointer: coarse)").matches;

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.closest("input, textarea, select, [role=menu], [role=dialog]") !==
      null);

const onKeyDown = (event: KeyboardEvent) => {
  if (!event.defaultPrevented && !event.isComposing) {
    dispatch(event, { editable: isEditable(event.target), mac: isMac() });
  }
};

export const registerCommands = (entry: Entry) => {
  entries.add(entry);

  return () => {
    entries.delete(entry);
  };
};

const listen = (entry: Entry) => {
  if (entries.size === 0) {
    window.addEventListener("keydown", onKeyDown);
  }

  const unregister = registerCommands(entry);

  return () => {
    unregister();

    if (entries.size === 0) {
      window.removeEventListener("keydown", onKeyDown);
    }
  };
};

export const useCommands = (commands: Command[], fallback = false) => {
  const entry = useRef<Entry>({ commands, fallback });

  useEffect(() => {
    entry.current.commands = commands;
  });

  useEffect(() => listen(entry.current), []);
};

export const useHotkey = (
  keys: string,
  run: () => void,
  options: Omit<Hotkey, "keys"> = {}
) => {
  useCommands([{ hotkey: { ...options, keys }, id: keys, run }]);
};

export const listCommands = () => {
  const commands: Command[] = [];

  for (const entry of entries) {
    if (!entry.fallback) {
      commands.push(
        ...entry.commands.filter(({ label }) => label !== undefined)
      );
    }
  }

  return commands;
};

const keyNames = new Map([
  ["arrowdown", "↓"],
  ["arrowleft", "←"],
  ["arrowright", "→"],
  ["arrowup", "↑"],
  ["backspace", "⌫"],
  ["enter", "↵"],
  ["escape", "Esc"],
]);

export const hotkeyCaps = (hotkey: Hotkey, mac: boolean) => [
  ...(hotkey.mod === true ? [mac ? "⌘" : "Ctrl"] : []),
  ...(hotkey.shift === true ? [mac ? "⇧" : "Shift"] : []),
  ...hotkey.keys
    .split(" ")
    .map((key) => keyNames.get(key) ?? key.toUpperCase()),
];
