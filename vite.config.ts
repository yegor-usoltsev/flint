import { readFileSync } from "node:fs";

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

export default defineConfig({
  build: { license: true },
  define: { "process.env.FLINT_COMMIT": JSON.stringify(commit()) },
  plugins: [
    tailwindcss(),
    tanstackStart(),
    nitro({
      plugins: [
        "./src/server/plugins/security-headers.ts",
        "./src/server/plugins/storage-sweep.ts",
        "./src/server/plugins/trash.ts",
      ],
      preset: "bun",
      routeRules: {
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
