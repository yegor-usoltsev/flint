export const isLoopback = (hostname: string) =>
  hostname === "localhost" ||
  hostname.endsWith(".localhost") ||
  hostname === "[::1]" ||
  /^127(?:\.\d{1,3}){3}$/u.test(hostname);

export const loginCommand = (origin: string) => {
  const url = new URL(origin);
  const insecure = url.protocol === "http:" && !isLoopback(url.hostname);

  return `flint login --url ${url.origin}${insecure ? " --insecure" : ""}`;
};
