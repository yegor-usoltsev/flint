// oxlint-disable-next-line sonarjs/no-wildcard-import -- Valibot documents `import * as v`.
import * as v from "valibot";

import { ApiError } from "~/server/api.server";

export const maxImagePixels = 50_000_000;

export const imageSides = { attachment: 2560, logo: 256 } as const;

const encoders = {
  jpeg: {
    encode: (image: Bun.Image) =>
      image.jpeg({ progressive: true, quality: 80 }),
    extensions: [".jpg", ".jpeg"],
  },
  png: { encode: (image: Bun.Image) => image.png(), extensions: [".png"] },
  webp: {
    encode: (image: Bun.Image) => image.webp({ quality: 80 }),
    extensions: [".webp"],
  },
} as const;

type Encoded = keyof typeof encoders;

const isEncoded = (format: string): format is Encoded =>
  Object.hasOwn(encoders, format);

export const normalizedTypes = new Set(
  Object.keys(encoders).map((format) => `image/${format}`)
);

const ascii = (bytes: Uint8Array, start: number, end: number) =>
  String.fromCodePoint(...bytes.subarray(start, end));

const pngChunks = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const types: string[] = [];

  for (let offset = 8; offset + 8 <= bytes.length;) {
    const type = ascii(bytes, offset + 4, offset + 8);

    types.push(type);

    if (type === "IEND") {
      break;
    }

    offset += 12 + view.getUint32(offset);
  }

  return types;
};

const riffChunks = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const types: string[] = [];

  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = view.getUint32(offset + 4, true);

    types.push(ascii(bytes, offset, offset + 4));
    offset += 8 + size + (size % 2);
  }

  return types;
};

const isAnimated = (bytes: Uint8Array, format: Encoded) =>
  format === "webp"
    ? riffChunks(bytes).includes("ANIM")
    : format === "png" && pngChunks(bytes).includes("acTL");

const pngMetadata = new Set(["eXIf", "iTXt", "tEXt", "zTXt"]);
const webpMetadata = new Set(["EXIF", "XMP "]);

const keepsOriginal = (bytes: Uint8Array, format: Encoded) => {
  if (format === "png") {
    return !pngChunks(bytes).some((type) => pngMetadata.has(type));
  }

  return (
    format === "webp" &&
    !riffChunks(bytes).some((type) => webpMetadata.has(type))
  );
};

const tooManyPixels = () =>
  new ApiError(
    413,
    "too_large",
    `Images are limited to ${maxImagePixels / 1_000_000} megapixels`
  );

const TooManyPixelsSchema = v.object({
  code: v.literal("ERR_IMAGE_TOO_MANY_PIXELS"),
});

export const normalizeImage = async (bytes: Uint8Array, maxSide: number) => {
  const image = () => new Bun.Image(bytes, { maxPixels: maxImagePixels });

  try {
    const { format, height, width } = await image().metadata();

    if (width * height > maxImagePixels) {
      throw tooManyPixels();
    }

    if (!isEncoded(format) || isAnimated(bytes, format)) {
      return null;
    }

    const { encode, extensions } = encoders[format];

    const data = await encode(
      image().resize(maxSide, maxSide, {
        fit: "inside",
        withoutEnlargement: true,
      })
    ).bytes();

    const keep =
      Math.max(width, height) <= maxSide &&
      data.byteLength >= bytes.byteLength &&
      keepsOriginal(bytes, format);

    return { data: keep ? bytes : data, extensions, type: `image/${format}` };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (v.is(TooManyPixelsSchema, error)) {
      throw tooManyPixels();
    }

    throw new ApiError(400, "invalid_request", "The image cannot be decoded");
  }
};
