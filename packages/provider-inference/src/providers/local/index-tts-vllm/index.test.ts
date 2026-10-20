import type { SpeechProviderWithExtraOptions } from '@xsai-ext/providers/utils'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { providerIndexTtsVllm } from '.'

describe('index tts speech requests', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('preserves reference expression when manual strength is zero', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('audio'))
    vi.stubGlobal('fetch', fetcher)
    const provider = await providerIndexTtsVllm.createProvider({ emotionMode: 'manual', emotionIntensity: 0 })
    if (!('speech' in provider))
      throw new Error('Missing speech provider')
    const options = provider.speech('IndexTTS-2.5')
    if (!options.fetch)
      throw new Error('Missing speech transport')
    await options.fetch(new URL('audio/speech', options.baseURL), { method: 'POST', body: JSON.stringify({ model: options.model, input: '你好。', voice: 'unicorn' }) })
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).emo_vector).toBeUndefined()
  })

  it('maps speech rate, emotion strength and an explicit sentence pause to native parameters', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('audio'))
    vi.stubGlobal('fetch', fetcher)
    const provider = await providerIndexTtsVllm.createProvider({ speed: 1.25, emotionMode: 'manual', emotion: 'happy', emotionIntensity: 0.4 })
    const client = provider as SpeechProviderWithExtraOptions<string, { pauseAfterMs: number }>
    const options = client.speech('IndexTTS-2.5', { pauseAfterMs: 250 })
    if (!options.fetch)
      throw new Error('Missing speech transport')
    await options.fetch(new URL('audio/speech', options.baseURL), {
      method: 'POST',
      body: JSON.stringify({ model: options.model, input: '你好。', voice: 'unicorn' }),
    })
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body))
    expect(body.duration_factor).toBe(0.8)
    expect(body.emo_vector).toEqual([0.4, 0, 0, 0, 0, 0, 0, 0])
    expect(body.pause_after_ms).toBe(250)
  })

  it('uses a span language instead of the saved auto default', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('audio'))
    vi.stubGlobal('fetch', fetcher)
    const provider = await providerIndexTtsVllm.createProvider({ language: 'auto' })
    if (!('speech' in provider))
      throw new Error('IndexTTS must expose speech synthesis')
    // The registry erases provider-specific options; this is the same transport contract consumers select.
    const client = provider as SpeechProviderWithExtraOptions<string, { language?: string }>
    const options = client.speech('IndexTTS-2.5', { language: 'JA' })
    if (!options.fetch)
      throw new Error('IndexTTS must expose a language-aware transport')
    await options.fetch(new URL('audio/speech', options.baseURL), {
      method: 'POST',
      body: JSON.stringify({ model: options.model, input: '了解。', voice: 'unicorn' }),
    })
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).language).toBe('JA')
  })

  it('forwards the selected model and Japanese language to the local API', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('audio'))
    vi.stubGlobal('fetch', fetcher)
    const provider = await providerIndexTtsVllm.createProvider({
      baseUrl: 'http://127.0.0.1:11996/tts/',
      model: 'IndexTTS-2.5',
      language: 'JA',
    })
    if (!('speech' in provider))
      throw new Error('IndexTTS must expose speech synthesis')
    const options = provider.speech('IndexTTS-2.5')
    expect(options.model).toBe('IndexTTS-2.5')
    expect(options.fetch).toBeTypeOf('function')
    if (!options.fetch)
      throw new Error('IndexTTS must provide its language-aware transport')
    await options.fetch(new URL('audio/speech', options.baseURL), {
      method: 'POST',
      body: JSON.stringify({ model: options.model, input: '今日は良い天気です。', voice: 'unicorn' }),
    })
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      model: 'IndexTTS-2.5',
      input: '今日は良い天気です。',
      voice: 'unicorn',
      language: 'JA',
      duration_factor: 1,
      pause_after_ms: 0,
    })
  })
})
