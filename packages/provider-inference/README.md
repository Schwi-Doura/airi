# Provider Inference

`@proj-airi/provider-inference` owns runtime-neutral AIRI provider definitions.

Use this package to list built-in providers, create provider configuration schemas, and create provider instances. The package runs in Node.js and Browser runtimes.

Do not use this package for provider configuration persistence, Vue views, Pinia state, authentication, or Electron-native providers. Those concerns remain in `@proj-airi/stage-ui`.

## Use

```ts
import { getDefinedProvider, listProviders } from '@proj-airi/provider-inference'

const provider = getDefinedProvider('openai')
const providers = listProviders()
```

Browser-only definitions, such as Web Speech API, load in Node.js. Their availability hook returns `false` when the required Browser capability is absent.

The root entry exports Sherpaw model presets and a definition factory. Vite plugins can use `@proj-airi/provider-inference/sherpaw-transcription/models` to load only model metadata. The presets include stable IDs, languages, recognizer types, pinned revisions, and artifact URLs. Neither entry downloads or loads model files.

`createSherpawTranscriptionDefinition` owns recognition, Worker cleanup, and the first model choice.
The host supplies exposed models, a Worker URL, a fetch function, and the current interface language.
The host also reports whether it runs on mobile. Chinese and English default to X-ASR on desktop and Paraformer on mobile.
`stage-ui` supplies these resources and adds the Hearing settings view.

Use `@proj-airi/stage-ui` for saved provider configuration, Vue settings views, Pinia state, authentication, and Electron-native providers. Do not use this package to manage those application concerns.

## Verify

### Independent Streaming Speech service

The `streaming-speech` provider connects to the independently maintained speech demo through API v1.
Use `http://127.0.0.1:18080/api/v1/` as the local Base URL.
The service owns SaT, annotation prompts and validation, WeText, S2 inference, voice references, and logs.
Configure an independent text API for annotation. Credentials apply to one connection without changing service files.
The service sends annotation requests, validates replies, and retries invalid annotation. AIRI never invokes its chat model for speech.

The API exposes `health`, `models`, `voices`, and a `speech/stream` WebSocket beneath the Base URL.
The socket accepts text chunks and returns sentence-framed mono PCM16 at 44100 Hz.
`StreamingSpeechClient` validates responses, inserts server-declared pauses, and cancels sockets when their response ends.
Settings previews collect the same stream into one WAV. Automatic speech uses the stage-ui PCM adapter.
Keep the independent service running before validating or selecting this provider.
Reference uploads use the service's `references` endpoint. AIRI persists only `referenceId`, which applies to previews and chat.
The service validates audio, stores immutable profiles, and caches encoded prompts.
Use reference ID `none` for the model voice without a recording. An empty reference ID selects the service reference, if saved.
Batch synthesis sends `merge_for_synthesis` and consumes `segments_merged` events. Pauses separate output batches.
Annotation always runs in batches. The removed `annotation_schedule` field never enters the request.

The service API contract and setup instructions live in that project's `API.md` and `README.md`.


## Generation protocols

OpenAI and OpenAI Compatible configurations accept `api: 'chat-completions' | 'responses'`. OpenAI defaults to `responses`. OpenAI Compatible defaults to `chat-completions`. Saved protocol choices take precedence. The provider settings page renders this field as an API protocol selector.

`ProviderDefinition` owns configuration and instance creation. `getGenerationProvider(instance)` adapts SDK Chat instances at that boundary.
`GenerationProvider.generation(model, options)` selects a protocol and returns its request configuration.
Core-agent receives this single interface and projects context directly into the selected protocol.
Protocol defaults and native tools remain provider-owned policy. The validation probe uses the selected protocol.
`generationProtocolDefinitions` owns the display metadata for every protocol.
Provider schemas use `generationProtocolOptions` to keep selector labels consistent.
Adding a protocol requires a request type and a matching metadata entry. TypeScript reports an incomplete registry or provider request switch.

```ts
const definition = getDefinedProvider('openai')
const provider = await definition.createProvider({
  apiKey: 'your-key',
  api: 'responses',
})
```

User-configured providers send Responses requests directly to their configured endpoint with their own API key. They do not require AIRI backend changes or Flux billing.
The official provider defaults to Responses and lets the user select Chat Completions.

OpenAI has a `webSearch` switch, disabled by default. The selected protocol must be Responses.
Explicitly enabling search sends the hosted tool on the official OpenAI endpoint. The provider validates model support.
Custom endpoints do not inherit this tool declaration. Model names never determine search support.
Search uses the configured OpenAI key and does not require an AIRI login or Tavily key.

## Model metadata

OpenAI and OpenRouter use their provider-specific [model-bank](https://github.com/lobehub/lobehub/tree/canary/packages/model-bank) catalogs.
The endpoint model list remains authoritative for availability. Catalog data only enriches exact model IDs on the matching endpoint.
Custom endpoints receive no metadata from official routes. There is no separate online catalog request or cache.
Upgrade the pinned model-bank dependency to refresh metadata.

`ModelInfo.metadata` uses model-bank's exported `AIChatModelCard` contract for abilities, settings, and pricing.
Currency and fixed, tiered, or lookup pricing remain intact. Catalog prices are advisory data, not Flux billing quotes.
Reported search abilities do not select a native tool implementation.

OpenAI reasoning controls use the exact model entry and effort levels from the pinned catalog.
Unsupported effort values are omitted. In particular, models without a `none` effort keep their server default when reasoning is disabled.
Generation validation uses the configured model before consulting the endpoint model list.
