export const newId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const now = Date.now();

  for (let index = 0; index < 6; index += 1) {
    bytes[index] = Math.floor(now / 2 ** (8 * (5 - index))) % 256;
  }

  bytes[6] = ((bytes[6] ?? 0) % 16) + 0x70;
  bytes[8] = ((bytes[8] ?? 0) % 64) + 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));

  return [
    hex.slice(0, 4),
    hex.slice(4, 6),
    hex.slice(6, 8),
    hex.slice(8, 10),
    hex.slice(10),
  ]
    .map((part) => part.join(""))
    .join("-");
};
