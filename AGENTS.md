# ima2-gen AI Context

## What This Project Does

`ima2-gen` is a local OAuth image generation studio with a CLI and React UI.

- Default generation path uses Codex/ChatGPT OAuth.
- API-key image generation is intentionally disabled.
- Classic generation, image edit/reference flows, multimode batches, local gallery, prompt library, and Canvas Mode are the main surfaces.
- Card News remains dev-only and experimental.

## Tech Stack

- Server: Express 5
- API client: OpenAI SDK v5
- OAuth: `openai-oauth`
- Frontend: React + Vite (`ui/src`, built to `ui/dist`)
- Tests: `node:test` contracts and regressions

## Project Structure

```text
bin/                  CLI entry and subcommands
routes/               Express API route modules
lib/                  Server/provider/storage helpers
assets/               Packaged static templates and docs screenshots
docs/                 User-facing references
scripts/              Local maintenance scripts
tests/                node:test contracts and regressions
ui/src/               React/Vite app source
ui/src/components/
  canvas-mode/        Canvas editor workspace and tools
  card-news/          Dev-only Card News workspace
  feedback/           Modals, toasts, billing/status surfaces
  gallery/            Thumbnail rail, gallery modal, queue/log surfaces
  generation/         Model, size, count, and generation mode controls
  layout/             App shell panels and mobile shell
  prompt/             Prompt composer, library, and import UI
  result/             Main image viewer and result actions
  settings/           Settings workspace and appearance/account controls
ui/dist/              Built frontend served by the package
```

## Conventions

- ES modules only.
- Prefer small feature folders over a flat component directory.
- Keep route handlers thin; provider/storage logic belongs in `lib/`.
- Keep generated images and user data outside the repo by default.
- Avoid reintroducing removed node-mode or ComfyUI surfaces.

## Verification

```bash
npm run typecheck
npm run ui:build
npm run build:server
npm run build:cli
npm run lint:pkg
npm test
```
