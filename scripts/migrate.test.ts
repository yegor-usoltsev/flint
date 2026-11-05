import { afterAll, beforeAll, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import path from "node:path";

import { SQL } from "bun";

const scratch = new URL(process.env["DATABASE_URL"] ?? "");

scratch.pathname = `${scratch.pathname}_migrations`;

const name = scratch.pathname.slice(1);
const maintenance = new URL(scratch);

maintenance.pathname = "/postgres";

const server = new SQL(maintenance.href);

const reset = async () => {
  await server.unsafe(`drop database if exists ${name} with (force)`);
  await server.unsafe(`create database ${name}`);
};

beforeAll(reset);

afterAll(async () => {
  await server.unsafe(`drop database if exists ${name} with (force)`);
  await server.close();
});

const migrate = async () => {
  const child = Bun.spawn(["bun", path.join(import.meta.dir, "migrate.ts")], {
    env: { ...process.env, DATABASE_URL: scratch.href },
    stderr: "pipe",
    stdout: "pipe",
  });

  const [code, stdout] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
  ]);

  return { applied: stdout.split("applied migration").length - 1, code };
};

test("concurrent runs apply each migration once and a rerun applies none", async () => {
  const entries = await readdir(path.join(import.meta.dir, "../migrations"));
  const files = entries.filter((file) => file.endsWith(".sql")).toSorted();

  const runs = await Promise.all([migrate(), migrate()]);

  expect(runs.map(({ code }) => code)).toEqual([0, 0]);
  expect(runs.map(({ applied }) => applied).toSorted((a, b) => a - b)).toEqual([
    0,
    files.length,
  ]);

  const sql = new SQL(scratch.href);

  try {
    const rows = await sql<{ name: string }[]>`
      select name from schema_migrations order by name
    `;

    expect(rows.map((row) => row.name)).toEqual(files);
  } finally {
    await sql.close();
  }

  expect(await migrate()).toEqual({ applied: 0, code: 0 });
});
