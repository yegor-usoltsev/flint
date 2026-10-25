import assert from "node:assert/strict";

const key = process.env["TINIFY_API_KEY"];

assert.ok(
  key !== undefined && key !== "",
  "Set TINIFY_API_KEY before exporting production PNGs"
);

const run = (args: string[]) => {
  const result = Bun.spawnSync(args, { stderr: "inherit", stdout: "inherit" });
  assert.equal(result.exitCode, 0, `${args[0]} failed`);
};

const compress = async (filePath: string) => {
  const original = await Bun.file(filePath).bytes();
  const credentials = btoa(`api:${key}`);
  const authorization = `Basic ${credentials}`;

  const uploaded = await fetch("https://api.tinify.com/shrink", {
    body: original,
    headers: { Authorization: authorization },
    method: "POST",
    signal: AbortSignal.timeout(60_000),
  });

  assert.ok(uploaded.ok, `Tinify upload failed: HTTP ${uploaded.status}`);
  const location = uploaded.headers.get("location");
  assert.ok(
    location !== null && location !== "",
    "Tinify did not return an output URL"
  );
  assert.equal(new URL(location).origin, "https://api.tinify.com");

  const response = await fetch(location, {
    headers: { Authorization: authorization },
    signal: AbortSignal.timeout(60_000),
  });

  assert.ok(response.ok, `Tinify download failed: HTTP ${response.status}`);
  assert.equal(response.headers.get("content-type"), "image/png");
  const compressed = await response.bytes();
  assert.deepEqual(compressed.slice(0, 8), original.slice(0, 8));
  assert.deepEqual(compressed.slice(16, 24), original.slice(16, 24));
  assert.ok(
    compressed.length < original.length,
    "Tinify did not reduce the PNG"
  );
  await Bun.write(filePath, compressed);
  process.stdout.write(
    `${filePath}: ${original.length} -> ${compressed.length} bytes\n`
  );
};

const outputs = [
  ["icon-rounded", "icon-512", 512],
  ["icon-rounded", "icon-192", 192],
  ["icon", "icon-maskable-512", 512],
  ["icon", "apple-touch-icon", 180],
] as const;

for (const [source, target, size] of outputs) {
  run([
    "rsvg-convert",
    "-w",
    `${size}`,
    "-h",
    `${size}`,
    `assets/${source}.svg`,
    "-o",
    `public/${target}.png`,
  ]);
}

run([
  "magick",
  "public/icon-512.png",
  "-define",
  "icon:auto-resize=48,32,16",
  "public/favicon.ico",
]);

await Promise.all(
  outputs.map(async ([, target]) => {
    await compress(`public/${target}.png`);
  })
);

run([
  "bunx",
  "--bun",
  "svgo@4.1.0",
  "--multipass",
  "--final-newline",
  "assets/icon-rounded.svg",
  "--output",
  "public/favicon.svg",
]);
