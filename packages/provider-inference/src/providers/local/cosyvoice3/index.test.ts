import { toWavFromPCM16 } from '@proj-airi/audio/encoding'
import { generateSpeech } from '@xsai/generate-speech'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { COSYVOICE3_MODEL, providerCosyVoice3 } from '.'

const referenceBytes = new Uint8Array(toWavFromPCM16(new Uint8Array([0, 0, 1, 0]), 16000))
const recording = `data:audio/wav;base64,${btoa(String.fromCharCode(...referenceBytes))}`
const reference = { referenceAudio: recording, referenceText: '参考音频原文。', referenceName: 'unicorn.wav' }

async function client(config: Parameters<typeof providerCosyVoice3.createProvider>[0] = reference) {
  const provider = await providerCosyVoice3.createProvider(config)
  if (!('speech' in provider))
    throw new Error('CosyVoice3 must expose speech synthesis')
  return provider
}

describe('cosyvoice3 native FastAPI provider', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends zero-shot multipart audio and transcript and returns one playable WAV', async () => {
    const pcm = new Uint8Array([0, 0, 255, 127, 0, 128])
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(pcm))
    vi.stubGlobal('fetch', fetcher)
    const provider = await client({ ...reference, baseUrl: 'http://localhost:50000/native' })
    const audio = await generateSpeech({ ...provider.speech(COSYVOICE3_MODEL), input: '你好。', voice: 'reference' })
    expect(String(fetcher.mock.calls[0][0])).toBe('http://localhost:50000/native/inference_zero_shot')
    const body = fetcher.mock.calls[0][1]?.body
    expect(body).toBeInstanceOf(FormData)
    if (!(body instanceof FormData))
      throw new Error('Missing native multipart body')
    expect(body.get('tts_text')).toBe('你好。')
    expect(body.get('prompt_text')).toBe('You are a helpful assistant.<|endofprompt|>参考音频原文。')
    const file = body.get('prompt_wav')
    if (!(file instanceof Blob))
      throw new Error('Missing reference recording')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(referenceBytes)
    expect(new TextDecoder().decode(audio.slice(0, 4))).toBe('RIFF')
    expect(new DataView(audio).getUint32(24, true)).toBe(24000)
    expect(new Uint8Array(audio, 44)).toEqual(pcm)
  })

  it.each(['zero-shot', 'cross-lingual', 'instruct'] as const)('synthesizes complete sentences separately in %s mode and joins PCM in source order', async (mode) => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(new Uint8Array([fetcher.mock.calls.length, 0])))
    vi.stubGlobal('fetch', fetcher)
    const provider = await client({ ...reference, mode, instruction: '请温柔地说话。' })
    const sentences = ['你好，这是通过 AIRI 生成的语音。', 'こんにちは。', '今日はいい天気ですね。']
    const audio = await generateSpeech({ ...provider.speech(COSYVOICE3_MODEL), input: sentences.join(''), voice: 'reference' })
    expect(fetcher).toHaveBeenCalledTimes(3)
    const forms = fetcher.mock.calls.map(([, init]) => init?.body as FormData)
    const prefix = mode === 'cross-lingual' ? 'You are a helpful assistant.<|endofprompt|>' : ''
    expect(forms.map(form => form.get('tts_text'))).toEqual(sentences.map(text => prefix + text))
    expect(forms.every(form => form.get('prompt_wav') instanceof Blob)).toBe(true)
    expect(new DataView(audio).getUint32(40, true)).toBe(6)
    expect(new Uint8Array(audio, 44)).toEqual(new Uint8Array([1, 0, 2, 0, 3, 0]))
  })

  it('stops later sentence requests when cancellation arrives during synthesis', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      controller.abort(new Error('Stopped between sentences'))
      return new Response(new Uint8Array([0, 0]))
    })
    vi.stubGlobal('fetch', fetcher)
    const provider = await client()
    await expect(generateSpeech({ ...provider.speech(COSYVOICE3_MODEL), input: '你好。こんにちは。', voice: 'reference', abortSignal: controller.signal })).rejects.toThrow('Stopped between sentences')
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('waits for each sentence response before requesting the next sentence', async () => {
    let finishFirst: ((response: Response) => void) | undefined
    const fetcher = vi.fn<typeof fetch>()
      .mockImplementationOnce(() => new Promise(resolve => finishFirst = resolve))
      .mockImplementation(async () => new Response(new Uint8Array([2, 0])))
    vi.stubGlobal('fetch', fetcher)
    const provider = await client()
    const pending = generateSpeech({ ...provider.speech(COSYVOICE3_MODEL), input: '你好。こんにちは。', voice: 'reference' })
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    if (!finishFirst)
      throw new Error('First sentence request did not start')
    finishFirst(new Response(new Uint8Array([1, 0])))
    const audio = await pending
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(new Uint8Array(audio, 44)).toEqual(new Uint8Array([1, 0, 2, 0]))
  })

  it('propagates a later sentence failure instead of returning partial speech', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 0])))
      .mockResolvedValueOnce(new Response('Generation failed', { status: 500 }))
    vi.stubGlobal('fetch', fetcher)
    const provider = await client()
    await expect(generateSpeech({ ...provider.speech(COSYVOICE3_MODEL), input: '你好。こんにちは。再见。', voice: 'reference' })).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('uses the cross-language endpoint without requiring a reference transcript', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array([0, 0])))
    vi.stubGlobal('fetch', fetcher)
    const provider = await client({ referenceAudio: recording, mode: 'cross-lingual' })
    await generateSpeech({ ...provider.speech(COSYVOICE3_MODEL), input: '今日はいい天気です。', voice: 'reference' })
    expect(String(fetcher.mock.calls[0][0])).toContain('/inference_cross_lingual')
    const form = fetcher.mock.calls[0][1]?.body as FormData
    expect(form.get('tts_text')).toBe('You are a helpful assistant.<|endofprompt|>今日はいい天気です。')
    expect(form.has('prompt_text')).toBe(false)
  })

  it('sends expression instructions separately from spoken text', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array([0, 0])))
    vi.stubGlobal('fetch', fetcher)
    const provider = await client({ referenceAudio: recording, mode: 'instruct', instruction: '请用愉快的语气说日语。' })
    await generateSpeech({ ...provider.speech(COSYVOICE3_MODEL), input: 'こんにちは。', voice: 'reference' })
    expect(String(fetcher.mock.calls[0][0])).toContain('/inference_instruct2')
    const form = fetcher.mock.calls[0][1]?.body as FormData
    expect(form.get('tts_text')).toBe('こんにちは。')
    expect(form.get('instruct_text')).toBe('You are a helpful assistant. 请用愉快的语气说日语。<|endofprompt|>')
  })

  it('rejects missing reference settings before sending an inference request', async () => {
    const fetcher = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetcher)
    const provider = await client({ referenceAudio: recording })
    await expect(generateSpeech({ ...provider.speech(COSYVOICE3_MODEL), input: '你好。', voice: 'reference' })).rejects.toThrow('transcript')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects unsupported models and arbitrary voice names', async () => {
    const fetcher = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetcher)
    const provider = await client()
    await expect(generateSpeech({ ...provider.speech('CosyVoice3-RL'), input: '你好。', voice: 'reference' })).rejects.toThrow()
    await expect(generateSpeech({ ...provider.speech(COSYVOICE3_MODEL), input: '你好。', voice: 'unknown' })).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([new Uint8Array(), new Uint8Array([1])])('rejects empty or truncated PCM instead of producing a broken clip', async (pcm) => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(pcm)))
    const provider = await client()
    await expect(generateSpeech({ ...provider.speech(COSYVOICE3_MODEL), input: '你好。', voice: 'reference' })).rejects.toThrow('PCM16')
  })

  it('forwards cancellation to the native service', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array([0, 0])))
    vi.stubGlobal('fetch', fetcher)
    const provider = await client()
    const controller = new AbortController()
    await generateSpeech({ ...provider.speech(COSYVOICE3_MODEL), input: '你好。', voice: 'reference', abortSignal: controller.signal })
    expect(fetcher.mock.calls[0][1]?.signal).toBe(controller.signal)
    controller.abort(new Error('Stopped'))
    await expect(generateSpeech({ ...provider.speech(COSYVOICE3_MODEL), input: '你好。', voice: 'reference', abortSignal: controller.signal })).rejects.toThrow('Stopped')
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('keeps server inference errors visible to the caller', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('Model unavailable', { status: 503 })))
    const provider = await client()
    await expect(generateSpeech({ ...provider.speech(COSYVOICE3_MODEL), input: '你好。', voice: 'reference' })).rejects.toThrow()
  })

  it('discovers only the ordinary model and the configured reference voice', async () => {
    const provider = await client()
    const methods = providerCosyVoice3.extraMethods!
    const models = await methods.listModels!(reference, provider)
    expect(models.map(model => model.id)).toEqual([COSYVOICE3_MODEL])
    expect(await methods.listVoices!({}, provider)).toEqual([])
    const voices = await methods.listVoices!(reference, provider)
    expect(voices[0].id).toBe('reference')
    expect(voices[0].name).toBe('unicorn.wav')
  })

  it('validates the native API contract without generating billable or slow audio', async () => {
    const { validator: validate } = await providerCosyVoice3.validators!.validateConfig![0]({ t: key => key })
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json({ paths: {
      '/inference_zero_shot': {},
      '/inference_cross_lingual': {},
      '/inference_instruct2': {},
    } })))
    expect((await validate(reference, { t: key => key })).valid).toBe(true)
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json({ paths: {} })))
    expect((await validate(reference, { t: key => key })).valid).toBe(false)
  })
})
