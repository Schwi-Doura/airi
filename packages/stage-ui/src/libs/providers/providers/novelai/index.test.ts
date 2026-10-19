import { generateSpeech } from '@xsai/generate-speech'
import { generateText } from '@xsai/generate-text'
import { listModels } from '@xsai/model'
import { stepCountAtLeast } from '@xsai/shared-chat'
import { streamText } from '@xsai/stream-text'
import { rawTool } from '@xsai/tool'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { providerNovelAI, providerNovelAISpeech } from '.'

afterEach(() => vi.restoreAllMocks())

/** @example describe('NovelAI adapters', () => {}) */
describe('novelai adapters', () => {
  /** @example it('executes a streamed artistry tool request and sends its result back', async () => {}) */
  it('executes a streamed artistry tool request and sends its result back', async () => {
    // ROOT CAUSE:
    // The adapter discarded tool definitions. The model printed widget JSON as
    // ordinary chat text and xsAI never invoked the registered Artistry tool.
    const execute = vi.fn(() => JSON.stringify({ message: 'Canvas created; image generation started.', imageUrl: 'data:image/png;base64,aGVsbG8=' }))
    const tool = rawTool({
      name: 'stage_widgets',
      description: 'Create an Artistry canvas',
      parameters: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'], additionalProperties: false },
      execute,
    })
    const fetcher = vi.spyOn(globalThis, 'fetch')
    for (const chunks of [
      ['{"na', 'me":"stage_widgets","arguments":{"prompt":"cat fishing on the moon"}}'],
      ['Image generation has started.'],
    ]) {
      const events = chunks.map((text, index) => `data: ${JSON.stringify({ choices: [{ index: 0, text, finish_reason: index === chunks.length - 1 ? 'stop' : null }] })}\n\n`).join('')
      fetcher.mockResolvedValueOnce(new Response(`${events}data: [DONE]\n\n`))
    }
    const provider = providerNovelAI.createProvider({ apiKey: 'token', baseUrl: 'https://text.novelai.net/oa/v1/' })
    if (!('chat' in provider))
      throw new Error('Expected a chat provider')
    const result = streamText({ ...provider.chat('glm-4-6'), messages: [{ role: 'user', content: 'Draw a cat.' }], tools: [tool], stopWhen: stepCountAtLeast(2) })
    let text = ''
    for await (const delta of result.textStream)
      text += delta
    // @example expect(execute).toHaveBeenCalledWith(args, options)
    expect(execute).toHaveBeenCalledWith({ prompt: 'cat fishing on the moon' }, expect.objectContaining({ toolCallId: expect.any(String) }))
    // @example expect(text).toBe('Image generation has started.')
    expect(text).toBe('Image generation has started.')
    // @example expect(body).not.toHaveProperty('tools')
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).not.toHaveProperty('tools')
    // @example expect(body.messages).toContainEqual(toolResult)
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body)).messages).toContainEqual(expect.objectContaining({ role: 'user', content: expect.stringContaining('Canvas created; image generation started.') }))
    // @example expect(body).not.toContain('data:image/png;base64,')
    expect(String(fetcher.mock.calls[1][1]?.body)).not.toContain('data:image/png;base64,')
    // @example expect(toolResult).toContain('data:image/png;base64,')
    expect((await result.steps)[0].toolResults[0].result).toContain('data:image/png;base64,')
  })

  /** @example it('discovers account models without generating text', async () => {}) */
  it('discovers account models without generating text', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ data: [{ id: 'glm-4-6' }] }))
    const provider = providerNovelAI.createProvider({ apiKey: 'token', baseUrl: 'https://text.novelai.net/oa/v1/' })
    if (!('model' in provider))
      throw new Error('Expected a model provider')
    const models = await listModels(provider.model())
    // @example expect(models[0].id).toBe('glm-4-6')
    expect(models[0].id).toBe('glm-4-6')
    // @example expect(fetcher.mock.calls[0][0].toString()).toContain('/oa/v1/models')
    expect(fetcher.mock.calls[0][0].toString()).toContain('/oa/v1/models')
    // @example expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  /** @example it('converts text parts and omits unsupported chat options', async () => {}) */
  it('converts text parts and omits unsupported chat options', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
      choices: [{ index: 0, finish_reason: 'stop', text: 'Hello' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }))
    const provider = providerNovelAI.createProvider({ apiKey: 'token', baseUrl: 'https://text.novelai.net/oa/v1/' })
    if (!('chat' in provider))
      throw new Error('Expected a chat provider')
    const response = await generateText({
      ...provider.chat('glm-4-6'),
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
      tools: [],
      temperature: 0.7,
    })
    const request: unknown = JSON.parse(String(fetcher.mock.calls[0][1]?.body))
    // @example expect(request).toMatchObject({ messages: [{ role: 'user', content: 'Hi' }] })
    expect(request).toMatchObject({ model: 'glm-4-6', messages: [{ role: 'user', content: 'Hi' }], temperature: 0.7 })
    // @example expect(request).not.toHaveProperty('tools')
    expect(request).not.toHaveProperty('tools')
    // @example expect(response.text).toBe('Hello')
    expect(response.text).toBe('Hello')
  })

  /** @example it('passes streaming chat deltas through the adapter', async () => {}) */
  it('passes streaming chat deltas through the adapter', async () => {
    const events = [
      { choices: [{ index: 0, text: 'Hello', finish_reason: null }] },
      { choices: [{ index: 0, text: '', finish_reason: 'stop' }] },
    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('')
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(`${events}data: [DONE]\n\n`, {
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    const provider = providerNovelAI.createProvider({ apiKey: 'token', baseUrl: 'https://text.novelai.net/oa/v1/' })
    if (!('chat' in provider))
      throw new Error('Expected a chat provider')
    const result = streamText({ ...provider.chat('glm-4-6'), messages: [{ role: 'user', content: 'Hi' }] })
    let text = ''
    for await (const delta of result.textStream)
      text += delta
    // @example expect(text).toBe('Hello')
    expect(text).toBe('Hello')
    // @example expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toHaveProperty('stream', true)
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toHaveProperty('stream', true)
  })

  /** @example it('rejects media rather than silently removing it', async () => {}) */
  it('rejects media rather than silently removing it', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
    const provider = providerNovelAI.createProvider({ apiKey: 'token', baseUrl: 'https://text.novelai.net/oa/v1/' })
    if (!('chat' in provider))
      throw new Error('Expected a chat provider')
    // @example await expect(generateText(options)).rejects.toThrow()
    await expect(generateText({
      ...provider.chat('glm-4-6'),
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,cG5n' } }] }],
    })).rejects.toThrow()
    // @example expect(fetcher).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  /** @example it('maps a custom v2 voice seed to native TTS and preserves cancellation', async () => {}) */
  it('maps a custom v2 voice seed to native TTS and preserves cancellation', async () => {
    const audio = new Uint8Array([82, 73, 70, 70])
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(audio))
    const controller = new AbortController()
    const provider = providerNovelAISpeech.createProvider({ apiKey: 'token', seed: 'seedmix:Kayra+Clio', baseUrl: 'https://api.novelai.net/' })
    if (!('speech' in provider))
      throw new Error('Expected a speech provider')
    const response = await generateSpeech({ ...provider.speech('v2'), input: 'Hello', voice: 'custom', abortSignal: controller.signal })
    const [url, init] = fetcher.mock.calls[0]
    // @example expect(url.toString()).toBe('https://api.novelai.net/ai/generate-voice')
    expect(url.toString()).toBe('https://api.novelai.net/ai/generate-voice')
    // @example expect(JSON.parse(String(init?.body))).toEqual({ text: 'Hello', seed: 'seedmix:Kayra+Clio', voice: -1, opus: false, version: 'v2' })
    expect(JSON.parse(String(init?.body))).toEqual({ text: 'Hello', seed: 'seedmix:Kayra+Clio', voice: -1, opus: false, version: 'v2' })
    // @example expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token')
    // @example expect(init?.signal).toBe(controller.signal)
    expect(init?.signal).toBe(controller.signal)
    // @example expect(new Uint8Array(response)).toEqual(audio)
    expect(new Uint8Array(response)).toEqual(audio)
  })

  /** @example it('uses the selected seed and does not retry upstream errors', async () => {}) */
  it('uses the selected seed and does not retry upstream errors', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ message: 'Unauthorized' }, { status: 401 }))
    const provider = providerNovelAISpeech.createProvider({ apiKey: 'token', seed: 'Maria', baseUrl: 'https://api.novelai.net/' })
    if (!('speech' in provider))
      throw new Error('Expected a speech provider')
    // @example await expect(generateSpeech(options)).rejects.toThrow()
    await expect(generateSpeech({ ...provider.speech('v1'), input: 'Hi', voice: 'Clio' })).rejects.toThrow()
    // @example expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ seed: 'Clio', version: 'v1' })
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ seed: 'Clio', version: 'v1' })
    // @example expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  /** @example it.skipIf(!process.env.NOVELAI_API_TOKEN)('lists live models with an explicit token', async () => {}) */
  it.skipIf(!process.env.NOVELAI_API_TOKEN)('lists live models with an explicit token', async () => {
    const provider = providerNovelAI.createProvider({ apiKey: process.env.NOVELAI_API_TOKEN || '', baseUrl: 'https://text.novelai.net/oa/v1/' })
    if (!('model' in provider))
      throw new Error('Expected a model provider')
    const models = await listModels(provider.model())
    // @example expect(models.length).toBeGreaterThan(0)
    expect(models.length).toBeGreaterThan(0)
  })
})
