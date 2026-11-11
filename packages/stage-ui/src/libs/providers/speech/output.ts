import type { SpeechOutput } from '@proj-airi/core-agent'

import { streamingSpeechConfigSchema } from '@proj-airi/provider-inference'

import { createStreamingSpeechOutput } from './streaming-speech/streaming'

/** The adapter captures configuration and the playback clock for one response. */
export interface SpeechProviderContext {
  readonly config: Record<string, unknown>
  readonly model: string
  readonly voice: string
  readonly nowMs: () => number
  readonly signal: AbortSignal
}

type OutputAdapter = (context: SpeechProviderContext) => Pick<Extract<SpeechOutput, { stream: unknown }>, 'stream'>

const adapters: Readonly<Record<string, OutputAdapter>> = {
  'streaming-speech': ({ config, model, voice, nowMs, signal }) => {
    const settings = streamingSpeechConfigSchema.parse({ ...config, model: model || config.model, voice: voice || config.voice })
    const output = createStreamingSpeechOutput(settings, nowMs)
    return { stream: (text, requestSignal) => output.stream(text, AbortSignal.any([requestSignal, signal])) }
  },
}

/** Other providers use the upstream speech path without local policies. */
export function getSpeechOutputAdapter(providerId: string): OutputAdapter | undefined {
  return adapters[providerId]
}
