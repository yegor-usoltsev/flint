# Brand assets

`icon.svg` (opaque: maskable and Apple touch icons) and `icon-rounded.svg` (transparent corners: favicons and the 192 and 512 px icons) are the sources of every icon in `public/`. Both are 512 × 512 and share the mark's paths and gradients, so change both. To regenerate `public/`, install ImageMagick and `rsvg-convert`, get a [Tinify](https://tinypng.com/developers) API key, and run from the repository root:

```sh
read -rs TINIFY_API_KEY && export TINIFY_API_KEY
bun scripts/dev/export-brand.ts
```

The main README shows `screenshots/`. The image ships them too, because the Getting started page of a workspace created with demo data reads them from `assets/screenshots` in the server's working directory.
