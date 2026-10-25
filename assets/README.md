# Brand assets

`icon.svg` (opaque, for the maskable and Apple touch icons) and `icon-rounded.svg` (transparent outside the squircle, for the favicons and the 192/512 icons) are the sources of every icon in `public/`. Both are 512 × 512 and share the mark's paths and gradients, so keep them in sync.

To regenerate `public/`, install Bun, ImageMagick and `rsvg-convert`, get a [Tinify](https://tinypng.com/developers) API key, and run from the repository root:

```sh
read -rs TINIFY_API_KEY && export TINIFY_API_KEY
bun scripts/dev/export-brand.ts
```

`screenshots/` holds the dark screenshots that `README.md` shows and the optional demo data uploads into its wiki guide; the image ships them, and the server reads them relative to its working directory.
