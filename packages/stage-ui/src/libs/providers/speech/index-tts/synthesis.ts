import type { GenerateText } from '@proj-airi/agents'
import type { SpeechOutput } from '@proj-airi/core-agent'
import type { TextToken } from '@proj-airi/pipelines-audio'
import type { IndexTtsSettings, IndexTtsSpeechOptions } from '@proj-airi/provider-inference'
import type { SpeechProviderWithExtraOptions } from '@xsai-ext/providers/utils'

import { toWav } from '@proj-airi/audio/encoding'
import { indexTtsSettingsSchema } from '@proj-airi/provider-inference'
import { generateSpeech } from '@xsai/generate-speech'

import { createLanguageSegmenter } from './language-segmentation'

type Synthesis = Extract<SpeechOutput, { synthesize: unknown }>

/**
 * Captures IndexTTS settings and voice for chat or a complete preview.
 *
 * Use when:
 * - Chat and settings need the same language, emotion, speed, and pause behavior.
 *
 * Expects:
 * - Validated settings and a renderer-owned provider. Chat-model annotation is optional for fixed settings.
 *
 * Returns:
 * - A segmenter, a per-span synthesizer, and a preview that joins decoded PCM into one valid WAV.
 */
export function createIndexTtsSpeech(
  provider: Promise<SpeechProviderWithExtraOptions<string, IndexTtsSpeechOptions>>,
  settings: IndexTtsSettings,
  voice: string,
  generateText?: GenerateText,
) {
  const segmenter = createLanguageSegmenter(settings.language, generateText, settings)
  const synthesize: Synthesis['synthesize'] = async (request, signal) => {
    signal.throwIfAborted()
    const client = await provider
    signal.throwIfAborted()
    const overrides: Record<string, unknown> = {
      ...settings,
      language: request.language ?? settings.language,
    }
    if (request.style?.emotion) {
      overrides.emotionMode = 'manual'
      overrides.emotion = request.style.emotion
      overrides.emotionIntensity = request.style.intensity ?? settings.emotionIntensity
    }
    const options: IndexTtsSpeechOptions = { ...indexTtsSettingsSchema.parse(overrides), pauseAfterMs: request.style?.pauseAfterMs ?? 0 }
    const audio = await generateSpeech({
      ...client.speech(settings.model, options),
      input: request.text,
      voice,
      abortSignal: signal,
    })
    signal.throwIfAborted()
    return new Blob([audio], { type: 'audio/wav' })
  }

  async function preview(text: string, context: AudioContext, signal: AbortSignal): Promise<ArrayBuffer> {
    const meta = { streamId: `preview:${crypto.randomUUID()}`, intentId: 'preview' }
    const tokens = new ReadableStream<TextToken>({ start(stream) {
      stream.enqueue({ ...meta, type: 'literal', value: text, sequence: 0, createdAt: Date.now() })
      stream.close()
    } })
    const buffers: AudioBuffer[] = []
    let sequence = 0
    for await (const segment of segmenter(tokens, meta, signal)) {
      const audio = await synthesize({ ...segment, priority: 0, sequence: sequence++ }, signal)
      if (!audio)
        throw new Error('IndexTTS returned no preview audio')
      buffers.push(await context.decodeAudioData(await audio.arrayBuffer()))
    }
    signal.throwIfAborted()
    if (!buffers.length)
      throw new Error('Enter text to generate speech')
    // decodeAudioData resamples to this context. Mix channels to mono before
    // joining PCM; concatenating WAV files would leave invalid embedded headers.
    const samples = new Float32Array(buffers.reduce((length, buffer) => length + buffer.length, 0))
    let offset = 0
    for (const buffer of buffers) {
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const source = buffer.getChannelData(channel)
        for (let frame = 0; frame < source.length; frame++)
          samples[offset + frame] += source[frame] / buffer.numberOfChannels
      }
      offset += buffer.length
    }
    return toWav(samples.buffer, context.sampleRate)
  }

  return { segmenter, synthesize, preview }
}
