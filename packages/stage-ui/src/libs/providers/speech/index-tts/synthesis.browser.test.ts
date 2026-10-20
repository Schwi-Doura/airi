import type { IndexTtsSpeechOptions } from '@proj-airi/provider-inference'
import type { SpeechProviderWithExtraOptions } from '@xsai-ext/providers/utils'

import { toWav } from '@proj-airi/audio/encoding'
import { getDefinedProvider, indexTtsSettingsSchema } from '@proj-airi/provider-inference'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createIndexTtsSpeech } from './synthesis'

describe('indexTTS preview audio', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('joins sentence PCM and pauses into one decodable WAV with the chat controls', async () => {
    const requests: { pause_after_ms: number, duration_factor: number, emo_vector: number[] }[] = []
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body))
      requests.push(body)
      const samples = new Float32Array(2205 + Math.round(22050 * body.pause_after_ms / 1000))
      samples.fill(0.1, 0, 2205)
      return new Response(toWav(samples.buffer, 22050), { headers: { 'Content-Type': 'audio/wav' } })
    }))
    const settings = indexTtsSettingsSchema.parse({ language: 'ZH', speed: 1.25, emotionMode: 'manual', emotion: 'happy' })
    const definition = getDefinedProvider('index-tts-vllm')
    if (!definition)
      throw new Error('Missing IndexTTS definition')
    const provider = Promise.resolve(await definition.createProvider(settings) as SpeechProviderWithExtraOptions<string, IndexTtsSpeechOptions>)
    const context = new AudioContext()
    try {
      const output = await createIndexTtsSpeech(provider, settings, 'unicorn').preview('你好。再见。', context, new AbortController().signal)
      const decoded = await context.decodeAudioData(output.slice(0))
      expect(decoded.duration).toBeCloseTo(0.45, 2)
      expect(requests.map(request => request.pause_after_ms)).toEqual([250, 0])
      expect(requests.map(request => request.duration_factor)).toEqual([0.8, 0.8])
      expect(requests[0].emo_vector).toEqual([0.4, 0, 0, 0, 0, 0, 0, 0])
      expect(decoded.getChannelData(0).some(sample => sample !== 0)).toBe(true)
    }
    finally {
      await context.close()
    }
  })
})
