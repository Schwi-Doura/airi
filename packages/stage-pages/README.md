# Stage Pages

Shared Vue settings and application pages for AIRI's web and desktop surfaces.
Import pages through this package's exports or the app's file-based router.
Use this package for shared page composition; reusable business logic belongs
in `stage-ui`, and Electron execution belongs in `stage-tamagotchi`.

## NovelAI settings

- `/settings/providers/chat/novelai`: Persistent API Token and OpenAI-compatible
  text endpoint; model selection is in the Consciousness module.
- `/settings/providers/speech/novelai-speech`: TTS v1/v2 and custom voice seeds.
- `/settings/providers/artistry/novelai`: native image endpoint and a model selector
  for V5, V4.5, V4, Anime V3 and Furry V3, with a custom model ID option.
  Image execution currently requires desktop.

See [module contracts and limitations](../stage-ui/README.md#novelai-modules).
