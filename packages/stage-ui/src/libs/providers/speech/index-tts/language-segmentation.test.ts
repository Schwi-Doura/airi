import type { GenerateText } from '@proj-airi/agents'
import type { TextSegment, TextToken } from '@proj-airi/pipelines-audio'

import { describe, expect, it, vi } from 'vitest'

import { createLanguageSegmenter } from './language-segmentation'

const meta = { streamId: 'speech', intentId: 'reply' }

async function collect(tokens: { type: TextToken['type'], value?: string }[], language: string, generate?: GenerateText, signal = new AbortController().signal) {
  const input = new ReadableStream<TextToken>({ start(stream) {
    tokens.forEach((token, sequence) => stream.enqueue({ ...meta, ...token, sequence, createdAt: 0 }))
    stream.close()
  } })
  const result: TextSegment[] = []
  for await (const segment of createLanguageSegmenter(language, generate)(input, meta, signal))
    result.push(segment)
  return result
}

describe('multilingual sentence segmentation', () => {
  it('caps automatic emotion, honors fixed language, and adds no pause at language switches', async () => {
    const generate = vi.fn<GenerateText>().mockResolvedValue(JSON.stringify([[
      { text: '她说', language: 'ZH', emotion: 'happy', intensity: 0.5 },
      { text: 'こんにちは。', language: 'JA', emotion: 'happy', intensity: 0.5 },
    ], [{ text: '再见。', language: 'ZH', emotion: 'neutral', intensity: 0 }]]))
    const input = new ReadableStream<TextToken>({ start(stream) {
      stream.enqueue({ ...meta, type: 'literal', value: '她说こんにちは。再见。', sequence: 0, createdAt: 0 })
      stream.close()
    } })
    const result: TextSegment[] = []
    for await (const part of createLanguageSegmenter('ZH', generate, { emotionMode: 'auto', emotionIntensity: 0.4 })(input, meta, new AbortController().signal))
      result.push(part)
    expect(result.map(part => part.language)).toEqual(['ZH', 'ZH', 'ZH'])
    expect(result.map(part => part.style?.pauseAfterMs)).toEqual([0, 250, 0])
    expect(result.map(part => part.style?.intensity)).toEqual([0.2, 0.2, 0])
    expect(result.map(part => part.style?.emotion)).toEqual(['happy', 'happy', 'neutral'])
    expect(generate).toHaveBeenCalledOnce()
  })
  it('adds pauses only between sentences and paragraphs, never after the final sentence', async () => {
    const input = new ReadableStream<TextToken>({ start(stream) {
      stream.enqueue({ ...meta, type: 'literal', value: '你好。再见。\nこんにちは。', sequence: 0, createdAt: 0 })
      stream.close()
    } })
    const result: TextSegment[] = []
    for await (const part of createLanguageSegmenter('ZH', undefined, { sentencePauseMs: 250, paragraphPauseMs: 500 })(input, meta, new AbortController().signal))
      result.push(part)
    expect(result.map(part => part.style?.pauseAfterMs)).toEqual([250, 500, 0])
  })
  it('keeps Japanese clauses together and labels mixed quotations using the full reply', async () => {
    const japanese = '今日はいい天気ですね、明日も一緒に公園へ行きましょう。'
    const mixed = '她说「おはよう」，然后离开。'
    const generate = vi.fn<GenerateText>().mockImplementation(async (conversation) => {
      const turn = conversation.turns[1]
      if (turn.type !== 'user')
        throw new Error('Expected language annotation source text')
      expect(turn.content).toEqual([{ type: 'text', text: JSON.stringify([japanese, mixed]) }])
      return JSON.stringify([
        [{ language: 'JA', text: japanese }],
        [{ language: 'ZH', text: '她说「' }, { language: 'JA', text: 'おはよう' }, { language: 'ZH', text: '」，然后离开。' }],
      ])
    })
    const result = await collect([{ type: 'literal', value: japanese.slice(0, 8) }, { type: 'literal', value: japanese.slice(8) + mixed }], 'auto', generate)
    expect(result.map(segment => segment.text)).toEqual([japanese, '她说「', 'おはよう', '」，然后离开。'])
    expect(result.map(segment => segment.language)).toEqual(['JA', 'ZH', 'JA', 'ZH'])
    expect(generate).toHaveBeenCalledOnce()
  })

  it('honors a fixed language and orders controls between sentences without an LLM call', async () => {
    const generate = vi.fn<GenerateText>()
    const result = await collect([
      { type: 'literal', value: '了解。先生。' },
      { type: 'special', value: 'wave' },
      { type: 'literal', value: 'はい、行きましょう。' },
    ], 'JA', generate)
    expect(result.map(segment => segment.text)).toEqual(['了解。', '先生。', '', 'はい、行きましょう。'])
    expect(result[2].special).toBe('wave')
    expect(result[3].language).toBe('JA')
    expect(generate).not.toHaveBeenCalled()
  })

  it('rejects invalid annotation instead of sending rewritten speech', async () => {
    const generate = vi.fn<GenerateText>().mockResolvedValue('[]')
    await expect(collect([{ type: 'literal', value: '你好。' }], 'auto', generate)).rejects.toThrow('preserve')
  })

  it('cancels pending annotation through the response signal', async () => {
    const abort = new AbortController()
    const generate = vi.fn<GenerateText>().mockImplementation(async (_conversation, signal) => {
      abort.abort(new Error('Interrupted'))
      signal.throwIfAborted()
      return '[]'
    })
    await expect(collect([{ type: 'literal', value: '你好。' }], 'auto', generate, abort.signal)).rejects.toThrow('Interrupted')
  })
})
