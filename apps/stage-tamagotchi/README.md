# Stage Tamagotchi

AIRI's Electron desktop app. The renderer composes shared Stage UI/pages;
the main process owns windows, desktop services, and Eventa IPC handlers.
Use this app for desktop integration; share platform-neutral UI and state in
`packages/stage-ui` and `packages/stage-pages` instead of duplicating it here.

Run `pnpm -F @proj-airi/stage-tamagotchi dev` from the workspace root.

## NovelAI Artistry

The native NovelAI image provider is registered in the Artistry bridge. Configure
its Persistent API Token and model in Settings → Providers → Artistry → NovelAI.
Configuration is synced through the existing Eventa Artistry contract and persisted
by the Artistry config schema. Responses use JSON/base64 PNGs instead of ZIP files.
This provider supports text-to-image; reference-image workflows are not exposed.

See [shared module configuration](../../packages/stage-ui/README.md#novelai-modules).
