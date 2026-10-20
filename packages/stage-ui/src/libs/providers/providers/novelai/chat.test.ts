import { generateText } from '@xsai/generate-text'
import { streamText } from '@xsai/stream-text'
import { describe, expect, it, vi } from 'vitest'

import { createChatProvider } from './chat'

/** @example describe('novelai completion decoding', () => {}) */
describe('novelai completion decoding', () => {
  it.each([
    { escaped: false, suffix: '' },
    { escaped: false, suffix: '\nThe image is already finished.' },
    { escaped: true, suffix: '\nThe image is already finished.' },
  ])('translates a tool envelope: %j', async ({ escaped, suffix }) => {
    const prefix = 'I will prepare a canvas.\n'
    const prompt = 'a cat with a "}" sign and a \\ path'
    const envelope = JSON.stringify({ name: 'stage_widgets', arguments: { prompt } })
    const encoded = escaped ? JSON.stringify(envelope).slice(1, -1) : envelope
    const provider = createChatProvider({
      apiKey: 'test',
      baseUrl: 'https://text.novelai.net/oa/v1/',
      fetch: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ index: 0, text: `${prefix}${encoded}${suffix}`, finish_reason: 'stop' }] })),
    })
    const response = await provider.chat('glm-4-6').fetch!(new URL('https://text.novelai.net/oa/v1/chat/completions'), {
      body: JSON.stringify({ model: 'glm-4-6', messages: [{ role: 'user', content: 'Draw a cat' }], tools: [{ type: 'function', function: { name: 'stage_widgets', parameters: { type: 'object' } } }] }),
    })
    const result = await response.json()
    expect(result.choices[0].finish_reason).toBe('tool_calls')
    expect(result.choices[0].message.content).toBe(prefix)
    expect(result.choices[0].message.tool_calls[0].function).toEqual({ name: 'stage_widgets', arguments: JSON.stringify({ prompt }) })
  })

  it.each([
    'Example:\n```json\n{"name":"stage_widgets","arguments":{}}\n```',
    'Example: {"name":"stage_widgets","arguments":{}}',
    'Example:\n{"component":"artistry","status":"done"}',
  ])('preserves JSON examples as text: %s', async (text) => {
    const provider = createChatProvider({
      apiKey: 'test',
      baseUrl: 'https://text.novelai.net/oa/v1/',
      fetch: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ index: 0, text, finish_reason: 'stop' }] })),
    })
    const response = await provider.chat('glm-4-6').fetch!(new URL('https://text.novelai.net/oa/v1/chat/completions'), {
      body: JSON.stringify({ model: 'glm-4-6', messages: [{ role: 'user', content: 'Show an example' }], tools: [{ type: 'function', function: { name: 'stage_widgets', parameters: { type: 'object' } } }] }),
    })
    const result = await response.json()
    expect(result.choices[0].message.content).toBe(text)
    expect(result.choices[0].message.tool_calls).toBeUndefined()
  })

  /** @example it('leaves an ordinary widget JSON example as chat text', async () => {}) */
  it('leaves an ordinary widget JSON example as chat text', async () => {
    const text = '{"component":"artistry","status":"done"}'
    const provider = createChatProvider({
      apiKey: 'test',
      baseUrl: 'https://text.novelai.net/oa/v1/',
      fetch: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ index: 0, text, finish_reason: 'stop' }] })),
    })
    const response = await provider.chat('glm-4-6').fetch!(new URL('https://text.novelai.net/oa/v1/chat/completions'), {
      body: JSON.stringify({ model: 'glm-4-6', messages: [{ role: 'user', content: 'Show JSON' }], tools: [{ type: 'function', function: { name: 'stage_widgets', parameters: { type: 'object' } } }] }),
    })
    const result = await response.json()
    // @example expect(message.content).toBe(text)
    expect(result.choices[0].message.content).toBe(text)
    // @example expect(message.tool_calls).toBeUndefined()
    expect(result.choices[0].message.tool_calls).toBeUndefined()
  })

  /** @example it('keeps tool-shaped text inert when tool choice is none', async () => {}) */
  it.each([false, true])('keeps tool-shaped text inert when tool choice is none, escaped: %j', async (escaped) => {
    const envelope = '{"name":"stage_widgets","arguments":{}}'
    const text = escaped ? JSON.stringify(envelope).slice(1, -1) : envelope
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ index: 0, text, finish_reason: 'stop' }] }))
    const provider = createChatProvider({ apiKey: 'test', baseUrl: 'https://text.novelai.net/oa/v1/', fetch: fetcher })
    const response = await provider.chat('glm-4-6').fetch!(new URL('https://text.novelai.net/oa/v1/chat/completions'), {
      body: JSON.stringify({ model: 'glm-4-6', messages: [{ role: 'user', content: 'Show an example' }], tools: [{ type: 'function', function: { name: 'stage_widgets', parameters: { type: 'object' } } }], tool_choice: 'none' }),
    })
    const result = await response.json()
    // @example expect(message.content).toBe(text)
    expect(result.choices[0].message.content).toBe(text)
    // @example expect(message.tool_calls).toBeUndefined()
    expect(result.choices[0].message.tool_calls).toBeUndefined()
  })

  /** @example it('translates non-streaming tool envelopes', async () => {}) */
  it('translates non-streaming tool envelopes', async () => {
    const text = JSON.stringify({ name: 'stage_widgets', arguments: JSON.stringify({ prompt: 'cat' }) })
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ index: 0, text, finish_reason: 'stop' }] }))
    const provider = createChatProvider({ apiKey: 'test', baseUrl: 'https://text.novelai.net/oa/v1/', fetch: fetcher })
    const response = await provider.chat('glm-4-6').fetch!(new URL('https://text.novelai.net/oa/v1/chat/completions'), {
      body: JSON.stringify({ model: 'glm-4-6', messages: [{ role: 'user', content: 'Draw a cat' }], tools: [{ type: 'function', function: { name: 'stage_widgets', parameters: { type: 'object' } } }] }),
    })
    const result = await response.json()
    // @example expect(choice.finish_reason).toBe('tool_calls')
    expect(result.choices[0].finish_reason).toBe('tool_calls')
    // @example expect(message.content).toBe('')
    expect(result.choices[0].message.content).toBe('')
    // @example expect(call.function).toEqual({ name: 'stage_widgets', arguments: '{"prompt":"cat"}' })
    expect(result.choices[0].message.tool_calls[0].function).toEqual({ name: 'stage_widgets', arguments: '{"prompt":"cat"}' })
  })

  /** @example it('rejects calls to tools absent from the offered catalogue', async () => {}) */
  it('rejects calls to tools absent from the offered catalogue', async () => {
    const provider = createChatProvider({
      apiKey: 'test',
      baseUrl: 'https://text.novelai.net/oa/v1/',
      fetch: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ index: 0, text: '{"name":"unavailable","arguments":{}}', finish_reason: 'stop' }] })),
    })
    // @example await expect(response).rejects.toThrow('unavailable tool')
    await expect(provider.chat('glm-4-6').fetch!(new URL('https://text.novelai.net/oa/v1/chat/completions'), {
      body: JSON.stringify({ model: 'glm-4-6', messages: [{ role: 'user', content: 'Draw' }], tools: [{ type: 'function', function: { name: 'stage_widgets', parameters: { type: 'object' } } }] }),
    })).rejects.toThrow('unavailable tool')
  })

  /** @example it('decodes native token-only choices into chat messages', async () => {}) */
  it('decodes native token-only choices into chat messages', async () => {
    // ROOT CAUSE:
    // Live /oa/v1/chat/completions returns choices[].token_ids with text="",
    // while xsAI reads choices[].message.content. Decode and map at the provider boundary.
    const decodeTokens = vi.fn(async () => '\nHello!')
    const provider = createChatProvider({
      apiKey: 'test',
      baseUrl: 'https://text.novelai.net/oa/v1/',
      decodeTokens,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(Response.json({
        choices: [{ index: 0, text: '', token_ids: [198, 9703, 0, 151336], finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 },
      })),
    })
    const result = await generateText({ ...provider.chat('glm-4-6'), messages: [{ role: 'user', content: 'Say hello.' }] })
    // @example expect(result.text).toBe('\nHello!')
    expect(result.text).toBe('\nHello!')
    // @example expect(decodeTokens).toHaveBeenCalledWith([198, 9703, 0, 151336])
    expect(decodeTokens).toHaveBeenCalledWith([198, 9703, 0, 151336])
  })

  /** @example it('decodes cumulative token chunks without corrupting split Unicode', async () => {}) */
  it('decodes cumulative token chunks without corrupting split Unicode', async () => {
    const decodeTokens = vi.fn(async (tokens: number[]) => tokens.length === 1 ? '\uFFFD' : '你好')
    const events = `${[
      { choices: [{ index: 0, token_ids: [1], text: '', finish_reason: null }] },
      { choices: [{ index: 0, token_ids: [2], text: '', finish_reason: 'stop' }] },
    ].map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join('')}data: [DONE]\r\n\r\n`
    const bytes = new TextEncoder().encode(events)
    const provider = createChatProvider({
      apiKey: 'test',
      baseUrl: 'https://text.novelai.net/oa/v1/',
      decodeTokens,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          // Exercise record delimiters split across transport chunks as well.
          for (let i = 0; i < bytes.length; i += 7)
            controller.enqueue(bytes.slice(i, i + 7))
          controller.close()
        },
      }))),
    })
    const result = streamText({ ...provider.chat('xialong-v1'), messages: [{ role: 'user', content: 'Hi' }] })
    let text = ''
    for await (const delta of result.textStream)
      text += delta
    // @example expect(text).toBe('你好')
    expect(text).toBe('你好')
    // @example expect(decodeTokens).toHaveBeenLastCalledWith([1, 2])
    expect(decodeTokens).toHaveBeenLastCalledWith([1, 2])
  })
})
