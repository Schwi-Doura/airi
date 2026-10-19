# Stage UI

Shared core for stage

## NovelAI modules

- **Consciousness:** select NovelAI, enter a Persistent API Token, and refresh the
  model list from `https://text.novelai.net/oa/v1/`. Only models returned by this
  endpoint are offered; native Kayra/Erato completion APIs are not chat adapters.
  Text content parts are converted to strings. Tool schemas are described in a
  text protocol; explicit JSON tool envelopes become xsAI tool events and actual
  execution results are returned as text messages. Ordinary JSON code blocks do
  not execute tools. Structured-output options are omitted and media is rejected.
  Native token-only JSON/SSE choices are decoded with the GLM-4.6 tokenizer via
  the existing Transformers.js dependency. The tokenizer files are downloaded
  and cached on first use; model weights are not downloaded.
- **Speech:** configure NovelAI TTS with `https://api.novelai.net/`, then select
  `v1` or `v2` in the Speech module. Select `custom` to use the configured seed,
  including v2 `seedmix:` expressions. This is voice design, not audio cloning.
  Selecting NovelAI initializes an empty/stale model to the provider's saved
  version (v2 by default) and an empty/stale voice to `custom`; valid selections
  are retained so the module is ready after choosing the provider.
  The adapter requests audio with `POST /ai/generate-voice`; the live v2 service
  returns MP3 when `opus` is false. Playback uses the browser's audio decoder.
- **Artistry (desktop):** select NovelAI Diffusion, enter the token and an exact
  native image model from the V5, V4.5, V4, Anime V3 and Furry V3 presets, or enter
  a custom ID. The default remains Anime V3 (`nai-diffusion-3`). The native
  endpoint is `https://image.novelai.net/ai/generate-image`; JSON image responses
  avoid ZIP extraction. Per-card `providerOptions.parameters` accepts `steps`,
  `scale`, `sampler`, and `seed`; width, height and negativePrompt use the existing
  Artistry fields. V4/V5 IDs receive the structured base captions. Image-to-image,
  per-character captions and reference images are not exposed by this adapter.
  The provider settings include an optional positive prompt prefix and negative
  prompt. Both are saved locally and applied to every NovelAI image request:
  the prefix precedes the drawing description, while the negative prompt combines
  with request-specific negatives. Non-empty parts are joined with commas, and
  V4/V5 structured captions use the same combined values.

Use these modules for user-initiated generation. Background validation does not
generate text or speech. NovelAI requires a subscription with the appropriate
model access; local configuration validation does not verify that access.

API contracts: [generation](https://text.novelai.net/docs/),
[voice](https://api.novelai.net/docs/),
[voice seeds](https://docs.novelai.net/en/text/usersettings/tts/).

## Histoire (UI storyboard)

https://histoire.dev/

```shell
pnpm -F @proj-airi/stage-ui run story:dev
```

### Project structure

1. If a story is bound to a specific component, it can be placed beside the component in the `src` folder. e.g., `MyComponent.story.vue`
2. If a story is not bound to a specific component, then it should be placed in the `stories` folder. e.g., `MyStory.story.vue`
