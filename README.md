# VectorVisualGen

Interactive high-resolution vector pattern studio focused on retro boomerang patterns, parametric SVG generation, color combinatorics, Figma sync, and Cloudflare deployment.

## Stack

- Next.js App Router, React 19, TypeScript
- Tailwind CSS v4 for the Material/Apple UI layer
- Framer Motion for micro-animations
- lucide-react for compact tool icons
- Native SVG generation for deterministic high-resolution vector output
- Next.js route handlers for Figma integration
- Cloudflare Workers deployment via `@opennextjs/cloudflare`

## Project Structure

```txt
src/app/page.tsx                  App entry
src/app/api/figma/sync/route.ts   Figma sync bridge
src/components/BoomerangGenerator.tsx
src/lib/boomerang.ts              Deterministic SVG pattern engine
public/references/                Local reference AVIF patterns
open-next.config.ts               Cloudflare OpenNext adapter
wrangler.toml                     Cloudflare Workers config
```

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Exports

- `SVG` downloads the full pattern with editable named layer groups.
- `Vrstvy` downloads three transparent SVG files: bottom, middle, and top layer.
- `PNG` renders the current full pattern as a high-resolution bitmap.

## Cloudflare

Cloudflare's current Next.js path is Workers with the OpenNext adapter.

```bash
npm run preview
npm run deploy
```

The committed `wrangler.toml` uses `.open-next/worker.js`, `.open-next/assets`, and `nodejs_compat`.

For Cloudflare Workers Builds, use:

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`

`npm run build` runs the OpenNext Cloudflare adapter and writes the `.open-next` output that Wrangler deploys.

## Figma

Create `.env.local` from `.env.example`:

```bash
FIGMA_ACCESS_TOKEN=
FIGMA_FILE_KEY=
FIGMA_NODE_ID=
```

The current endpoint validates and packages the generated SVG together with up to five saved gallery SVGs. Direct canvas insertion still requires a Figma plugin bridge or OAuth-based workflow, because Figma REST does not provide arbitrary write access for creating vector layers in a user file.

## Roadmap

- Browser-side bitmap tracing pipeline: threshold, contour extraction, simplification, SVG path conversion
- Pattern gallery tags, color filters, and infinite scrolling
- Figma plugin bridge for one-click insertion and live updates from gallery payloads
- Export presets for tile repeats, print sizes, and transparent backgrounds
