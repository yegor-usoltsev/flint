import { describe, expect, test } from "bun:test";

import { loginCommand } from "./loopback";

describe("loginCommand", () => {
  test("adds --insecure only for http on another host", () => {
    expect(loginCommand("http://localhost:4700")).toBe(
      "flint login --url http://localhost:4700"
    );
    expect(loginCommand("https://flint.example.com")).toBe(
      "flint login --url https://flint.example.com"
    );
    // oxlint-disable-next-line sonarjs/no-clear-text-protocols -- the test asserts how an http origin is handled
    expect(loginCommand("http://192.168.1.5:4700")).toBe(
      "flint login --url http://192.168.1.5:4700 --insecure"
    );
  });
});
