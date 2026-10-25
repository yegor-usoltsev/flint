import { expect, test } from "bun:test";

import { imageSides, normalizeImage } from "~/server/images.server";

const fixture = async (name: string) =>
  Buffer.from(
    await Bun.file(`${import.meta.dir}/../../test/fixtures/${name}`).bytes()
  );

const pngChunk = (type: string, data: Uint8Array) => {
  const chunk = Buffer.alloc(12 + data.length);

  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, "latin1");
  chunk.set(data, 8);
  chunk.writeUInt32BE(
    Bun.hash.crc32(chunk.subarray(4, 8 + data.length)),
    8 + data.length
  );

  return chunk;
};

const normalized = async (bytes: Uint8Array) => {
  const result = await normalizeImage(bytes, imageSides.attachment);

  return Buffer.from(result?.data ?? []);
};

test("a JPEG always loses its EXIF, even behind fill bytes and when re-encoding grows it", async () => {
  const oriented = await fixture("oriented.jpg");
  const exif = oriented.indexOf(Buffer.from([0xff, 0xe1]));

  const app1 = oriented.subarray(
    exif,
    exif + 2 + oriented.readUInt16BE(exif + 2)
  );

  const tiny = Buffer.from(
    await new Bun.Image(await fixture("noise.png"))
      .jpeg({ progressive: true, quality: 5 })
      .bytes()
  );

  const hidden = Buffer.concat([
    tiny.subarray(0, 2),
    Buffer.from([0xff]),
    app1,
    tiny.subarray(2),
  ]);

  for (const input of [oriented, hidden]) {
    // oxlint-disable-next-line no-await-in-loop -- Images normalize one at a time.
    const output = await normalized(input);

    expect(output.includes("Exif\0\0")).toBe(false);
  }
});

test("a PNG with text chunks is re-encoded without them", async () => {
  const png = await fixture("noise.png");
  const ihdrEnd = 8 + 12 + 13;

  const tagged = Buffer.concat([
    png.subarray(0, ihdrEnd),
    pngChunk("tEXt", new TextEncoder().encode("Location\0Home")),
    png.subarray(ihdrEnd),
  ]);

  const output = await normalized(tagged);

  expect(output.includes("tEXt")).toBe(false);
  expect(output.includes("Home")).toBe(false);
});
