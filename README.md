# Data-Ready SVG Exporter

[![Data-Ready SVG Exporter](assets/logo.jpeg)](https://www.figma.com/community/plugin/1612966729664067273/data-ready-svg-exporter)
[![Figma](https://img.shields.io/badge/Figma-Community%20Plugin-EA4C89?style=flat-square&logo=figma&logoColor=white)](https://www.figma.com/community/plugin/1612966729664067273/data-ready-svg-exporter)

**Convert Figma blocks to SVG with preserved layer markup for auto-generating documents.**  
Export page-like nodes into contract-friendly `page.svg` and sidecar `page.json` so downstream pipelines can substitute data into slots and render PDFs.

- **SVG** — Full frame as one SVG: static background (vector, shapes, images) plus **text slots** as `<g id="…"><text>…<tspan>…</text></g>` and **image slots** as `<g id="…"><rect fill="none"/>…</g>`. Slots keep stable `id`s; text keeps font, size, fill, position. Used as the visual template for PDF/layout engines.
- **Sidecar JSON** — Page metadata (id, index, size), list of slots with id, type, bounds, and for text slots font/style and sample text. Used to validate export, drive substitution (which slot gets which data), and as a fallback when parsing SVG is not enough.

## Architecture

- `plugin/code.ts` — Figma Plugin API, collects selection and runs export
- `plugin/exportCore.ts` — builds SVG and sidecar from collected data (TypeScript)
- `plugin/contracts.ts` — DTO types
- `scripts/build.mjs` — bundles the plugin with esbuild

## Requirements

- Node.js and npm

## Build

Install dependencies:

```bash
npm install
```

Build the plugin:

```bash
npm run build
```

This runs `scripts/build.mjs`: bundles `plugin/code.ts`, embeds `plugin/ui.html`, writes `dist/code.js` and `dist/ui.html`.

## Run in Figma

1. Run `npm run build`
2. Open Figma Desktop → **Plugins** → **Development** → **Import plugin from manifest...**
3. Select `manifest.json` from this repo
4. Run the plugin from **Plugins** → **Development**

## How it works

1. Select one root node named like `[p1]`, `[p2]` or `[p2] Block_name`
2. Plugin exports the full frame as SVG via Figma’s API (`exportAsync` SVG_STRING)
3. Slots matching the naming contract are detected; text and image slots are emitted by contract (`<g id="..."><text>...</text></g>` and `<g id="..."><rect fill="none"/>...</g>`)
4. Mixed-style text is split into segments (multiple `<tspan>`); rotated slots get `transform="rotate(...)"`
5. Result: one full SVG plus sidecar JSON and diagnostics

## Naming contract

Format: `[p{page}-{zone}-{type}-{slot}]`. Zone (`l`, `r`, `hero`, etc.) is free; page number, type, and slot number are required.

| Layer name | Meaning | Example use |
|------------|--------|-------------|
| `[p1]`, `[p2] Title` | Page root | Page 1, Page 2 with optional title |
| `[p2-l-str-1]` | Text (string) | Name, label, caption |
| `[p2-r-str-2]` | Text (string) | Another text slot on same page |
| `[p2-l-i32-1]` | Integer | Year, count, index |
| `[p2-l-f64-1]` | Decimal | Price, weight, percentage |
| `[p2-l-bool-1]` | Boolean | Checkmark, on/off |
| `[p2-l-img-1]` | Image | Logo, photo placeholder |

- **Pages:** `[p1]`, `[p2]`, `[p10]`, or `[p2] Block_name`.
- **Text slots** (str, i32, f64, bool): `[p2-r-str-1]`, `[p2-l-i32-1]`, `[p2-r-f64-1]`, `[p2-r-bool-1]`.
- **Image slot:** `[p2-l-img-1]`.

See `docs/data-ready-svg-exporter-contract.md` and `docs/design-note.md`.

## Development

- `manifest.json` points to `dist/code.js` and `dist/ui.html`
- No network access
- Typecheck: `npm run typecheck`
