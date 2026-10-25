import { describe, expect, test } from "bun:test";

import {
  emptySelection,
  extended,
  selectedAll,
  toggled,
  within,
  without,
} from "~/lib/issue-selection";
import type { Selection } from "~/lib/issue-selection";

const order = ["a", "b", "c", "d", "e"];
const ids = (selection: Selection) => [...selection.ids].toSorted();

describe("issue selection", () => {
  test("toggling adds and removes a row and moves the anchor", () => {
    const one = toggled(emptySelection, "b");
    const two = toggled(one, "d");

    expect(ids(two)).toEqual(["b", "d"]);
    expect(two.anchor).toBe("d");
    expect(ids(toggled(two, "b"))).toEqual(["d"]);
  });

  test("X then Shift+Down twice selects three rows", () => {
    let selection = toggled(emptySelection, "a");

    selection = extended(selection, order, "a", "b");
    selection = extended(selection, order, "b", "c");

    expect(ids(selection)).toEqual(["a", "b", "c"]);
  });

  test("moving back over the range shrinks it to the anchor", () => {
    let selection = toggled(emptySelection, "b");

    selection = extended(selection, order, "b", "d");
    selection = extended(selection, order, "d", "c");

    expect(ids(selection)).toEqual(["b", "c"]);
    selection = extended(selection, order, "c", "a");
    expect(ids(selection)).toEqual(["a", "b"]);
  });

  test("a range keeps rows toggled before the anchor was set", () => {
    let selection = toggled(emptySelection, "e");

    selection = toggled(selection, "a");
    selection = extended(selection, order, "a", "c");

    expect(ids(selection)).toEqual(["a", "b", "c", "e"]);
  });

  test("a range without an anchor starts at the focused row", () => {
    const selection = extended(emptySelection, order, "b", "d");

    expect(ids(selection)).toEqual(["b", "c", "d"]);
    expect(selection.anchor).toBe("b");
  });

  test("a range to a row outside the order selects just that row", () => {
    const selection = extended(toggled(emptySelection, "a"), order, "a", "z");

    expect(ids(selection)).toEqual(["a", "z"]);
  });

  test("select all takes every row", () => {
    expect(ids(selectedAll(order))).toEqual(order);
  });

  test("removing rows drops them and a removed anchor", () => {
    const selection = without(
      extended(toggled(emptySelection, "b"), order, "b", "d"),
      new Set(["b", "c"])
    );

    expect(ids(selection)).toEqual(["d"]);
    expect(selection.anchor).toBeNull();
  });

  test("rows that leave the view leave the selection", () => {
    const selection = within(selectedAll(order), new Set(["b", "d", "z"]));

    expect(ids(selection)).toEqual(["b", "d"]);
    expect(selection.anchor).toBeNull();
  });
});
