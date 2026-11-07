# Brand assets

`icon.svg` (opaque: maskable and Apple touch icons) and `icon-rounded.svg` (transparent corners: favicons and the 192 and 512 px icons) are the sources of every icon in `public/`. Both are 512 × 512 and share the mark's paths and gradients, so change both. To regenerate `public/`, install Bun, ImageMagick and `rsvg-convert`, get a [Tinify](https://tinypng.com/developers) API key, and run from the repository root:

```sh
read -rs TINIFY_API_KEY && export TINIFY_API_KEY
bun scripts/dev/export-brand.ts
```

The main README shows `screenshots/`. The image ships them too, because the Getting started page of a workspace created with demo data reads them from `assets/screenshots` in the server's working directory.

To retake the screenshots, run Flint with `bun run demo` data (a worktree can use its own database, see [docs/development.md](../docs/development.md#worktrees)) and sign `agent-browser` in as `alice` at `set viewport 1440 900 2` and `set media dark`. Capture PNGs of the Engineering project in board layout (`board`), the Cmd+K menu searching `checkout` over the list layout (`search`), the full page of ENG-5 while a second session as `bob` has it open (`issue`) and `engineering/architecture` with its wiki folder expanded (`wiki`); blur the focused element and keep the pointer off the page. Convert each PNG once with Tinify, which keeps the 2880 × 1800 size:

```sh
for f in board issue search wiki; do
  url=$(curl -fsS --user "api:$TINIFY_API_KEY" --data-binary @"$f.png" -D - -o /dev/null https://api.tinify.com/shrink | tr -d '\r' | awk 'tolower($1) == "location:" { print $2 }')
  curl -fsS --user "api:$TINIFY_API_KEY" -H 'Content-Type: application/json' -d '{"convert":{"type":"image/webp"}}' -o "$f.webp" "$url" &&
    mv "$f.webp" "assets/screenshots/$f.webp"
done
```
