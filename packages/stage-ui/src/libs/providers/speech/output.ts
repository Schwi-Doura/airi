import type { GenerateText } from '@proj-airi/agents'
import type { SpeechOutput } from '@proj-airi/core-agent'
import type { SpeechProviderWithExtraOptions } from '@xsai-ext/providers/utils'

import { createTtsSegmentStream } from '@proj-airi/pipelines-audio'
import { indexTtsSettingsSchema } from '@proj-airi/provider-inference'

import { createIndexTtsSpeech } from './index-tts/synthesis'

type SynthesisOutput = Extract<SpeechOutput, { synthesize: unknown }>

/** One response owns this settings snapshot and the optional character chat client. */
export interface SpeechProviderContext {
  readonly provider: Promise<SpeechProviderWithExtraOptions<string, Record<string, unknown>>>
  readonly config: Record<string, unknown>
  readonly model: string
  readonly voice: string
  readonly generateText?: GenerateText
}

type OutputAdapter = (context: SpeechProviderContext) => Partial<Pick<SynthesisOutput, 'segmenter' | 'synthesize' | 'textDelivery' | 'ttsMaxConcurrent'>>

const adapters: Readonly<Record<string, OutputAdapter>> = {
  'index-tts-vllm': ({ provider, config, model, voice, generateText }) => {
    const { segmenter, synthesize } = createIndexTtsSpeech(provider, indexTtsSettingsSchema.parse({ ...config, model }), voice, generateText)
    return { segmenter, synthesize }
  },
  'cosyvoice3': () => ({
    segmenter: (tokens, meta) => createTtsSegmentStream(tokens, meta, { boost: 0, maximumWords: Number.POSITIVE_INFINITY }),
    textDelivery: 'sentence',
    ttsMaxConcurrent: 1,
  }),
}

/** Unregistered providers keep the shared synthesis path and pipeline defaults. */
export function getSpeechOutputAdapter(providerId: string): OutputAdapter | undefined {
  return adapters[providerId]
}
