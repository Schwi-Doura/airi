# Speech provider boundaries

## Status

Accepted.

## Context

Local speech providers need different request formats, segmentation policies, controls, and preview behavior.
Provider branches in shared stores and pages increase upstream merge costs.
Complete-response buffering also delays providers that can synthesize each sentence as chat text arrives.

## Decision

Native protocols and settings schemas belong to `packages/provider-inference`.
Renderer output adapters belong to `packages/stage-ui/src/libs/providers/speech/output.ts`.
Provider presentation belongs to the adjacent `presentation.ts` module and provider controls.
Shared stores and settings pages select these extensions without local provider IDs.

IndexTTS owns its annotation prompt, reply validation, language segmentation, and preview audio under `speech/index-tts/`.
CosyVoice3 selects sentence delivery and one synthesis request at a time through its output adapter.
NovelAI owns native requests, tool parsing, and text-generation serialization in its provider directory.

The core agent keeps generic hooks for text delivery, segmentation, and synthesis concurrency.
Stage supplies the selected character's chat client as an optional capability.
Only providers that need annotation use that capability.
Runtime clients and cancellation controllers stay outside synchronized settings state.

## Consequences

Provider-specific changes normally affect provider code and thin settings route entries.
Shared core hooks remain necessary for immediate sentence synthesis and ordered playback.
Future upstream implementations can replace those hooks without rewriting native provider protocols.
Generic fixes and provider features use separate commits so that later merges can compare their ownership.

Model weights and local Python service installations remain separate deployments.
The AIRI repository contains client integration and deployment instructions.
