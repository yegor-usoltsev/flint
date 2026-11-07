import { readdirSync, readFileSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import path from "node:path";

import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import type { Plugin } from "vite";

import { licenseNotice } from "./scripts/licenses.ts";

const commit = () => {
  try {
    return (
      Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"])
        .stdout.toString()
        .trim() || "dev"
    );
  } catch {
    return "dev";
  }
};

const cssLicenses = (): Plugin => ({
  applyToEnvironment: (environment) => environment.name === "client",
  generateBundle: {
    handler(_, bundle) {
      const asset = bundle[".vite/license.md"];

      if (asset?.type !== "asset") {
        return;
      }

      const css = readFileSync("src/styles.css", "utf-8");

      const notices = css
        .matchAll(/@import "(?<name>(?:@[^/"]+\/)?[^/"]+)/gu)
        .map(({ groups }) => licenseNotice(`node_modules/${groups?.["name"]}`));

      asset.source = `${String(asset.source)}${[...notices].join("")}`;
    },
    order: "post",
  },
  name: "flint:css-licenses",
});

const privateSourcemaps = (): Plugin => ({
  applyToEnvironment: (environment) => environment.name === "client",
  name: "flint:private-sourcemaps",
  writeBundle: async ({ dir = "" }, bundle) => {
    await Promise.all(
      Object.keys(bundle)
        .filter((file) => file.endsWith(".map"))
        .map(async (file) => {
          const target = path.join(dir, "../sourcemaps", file);

          await mkdir(path.dirname(target), { recursive: true });
          await rename(path.join(dir, file), target);
        })
    );
  },
});

export default defineConfig({
  build: { license: true, sourcemap: "hidden" },
  define: { "process.env.FLINT_COMMIT": JSON.stringify(commit()) },
  plugins: [
    tailwindcss(),
    tanstackStart(),
    nitro({
      compressPublicAssets: { brotli: true, gzip: true },
      plugins: [
        "./src/server/plugins/security-headers.ts",
        "./src/server/plugins/storage-sweep.ts",
        "./src/server/plugins/trash.ts",
      ],
      preset: "bun",
      routeRules: {
        ...Object.fromEntries(
          readdirSync("public").map((name) => [
            `/${name}`,
            { headers: { "Cache-Control": "public, max-age=86400" } },
          ])
        ),
        "/files/**": {
          headers: {
            "Content-Security-Policy":
              "default-src 'none'; media-src 'self'; sandbox allow-same-origin",
          },
        },
        "/assets/**": {
          headers: { "Cache-Control": "public, max-age=31536000, immutable" },
        },
      },
    }),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    cssLicenses(),
    privateSourcemaps(),
  ],
  optimizeDeps: { exclude: ["bun"] },
  resolve: { tsconfigPaths: true },
  server: {
    allowedHosts: ["host-relay"],
    host: true,
    port: 4700,
    strictPort: true,
  },
});
