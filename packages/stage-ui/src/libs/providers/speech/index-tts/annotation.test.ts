import type { GenerateText } from '@proj-airi/agents'

import { describe, expect, it, vi } from 'vitest'

import { createVoiceLanguageAgent } from './annotation'

describe('speech language annotation', () => {
  it('restores original whitespace without dropping speech when annotation reformats text', async () => {
    const generate = vi.fn<GenerateText>().mockResolvedValue(JSON.stringify([[
      { language: 'ZH', text: '她说' },
      { language: 'JA', text: 'こんにちは。' },
    ]]))
    const result = await createVoiceLanguageAgent(generate).annotate(['她说 こんにちは。\n'], new AbortController().signal)
    expect(result.map(sentence => sentence.map(span => span.text).join(''))).toEqual(['她说 こんにちは。\n'])
    expect(result[0][1].text).toBe(' こんにちは。\n')
    expect(generate).toHaveBeenCalledOnce()
  })

  it('retries invalid annotations once and keeps the original words', async () => {
    const generate = vi.fn<GenerateText>()
      .mockResolvedValueOnce('[]')
      .mockResolvedValueOnce('[[{"language":"ZH","text":"你好。"}]]')
    const result = await createVoiceLanguageAgent(generate).annotate(['你好。'], new AbortController().signal)
    expect(result[0][0].text).toBe('你好。')
    expect(generate).toHaveBeenCalledTimes(2)
  })
  it('labels emotion and language in one request while keeping mixed spans consistent', async () => {
    const spans = [[
      { text: '她说', language: 'ZH', emotion: 'happy', intensity: 0.5 },
      { text: 'こんにちは。', language: 'JA', emotion: 'happy', intensity: 0.5 },
    ]]
    const generate = vi.fn<GenerateText>().mockResolvedValue(JSON.stringify(spans))
    const result = await createVoiceLanguageAgent(generate).annotate(['她说こんにちは。'], new AbortController().signal, true)
    expect(result).toEqual(spans)
    expect(generate).toHaveBeenCalledOnce()
  })

  it('rejects conflicting emotions inside one sentence', async () => {
    const generate = vi.fn<GenerateText>().mockResolvedValue(JSON.stringify([[
      { text: '她说', language: 'ZH', emotion: 'happy', intensity: 0.5 },
      { text: 'こんにちは。', language: 'JA', emotion: 'sad', intensity: 0.5 },
    ]]))
    await expect(createVoiceLanguageAgent(generate).annotate(['她说こんにちは。'], new AbortController().signal, true)).rejects.toThrow('consistent')
  })
  it('preserves Chinese narration, Japanese quotations and contextual kanji spans', async () => {
    const spans = [
      [{ language: 'ZH', text: '她说「' }, { language: 'JA', text: 'おはよう' }, { language: 'ZH', text: '」，然后离开。' }],
      [{ language: 'JA', text: '了解。' }],
    ]
    const generate = vi.fn<GenerateText>().mockResolvedValue(JSON.stringify(spans))
    const input = ['她说「おはよう」，然后离开。', '了解。']
    const result = await createVoiceLanguageAgent(generate).annotate(input, new AbortController().signal)
    expect(result).toEqual(spans)
    const turn = generate.mock.calls[0][0].turns[1]
    if (turn.type !== 'user')
      throw new Error('Expected language annotation source text')
    expect(turn.content).toEqual([{ type: 'text', text: JSON.stringify(input) }])
  })

  it('rejects omitted sentences instead of silently dropping spoken text', async () => {
    const generate = vi.fn<GenerateText>().mockResolvedValue('[]')
    await expect(createVoiceLanguageAgent(generate).annotate(['今天。'], new AbortController().signal)).rejects.toThrow('preserve')
  })

  it('rejects translated or rewritten text', async () => {
    const generate = vi.fn<GenerateText>().mockResolvedValue('[[{"language":"JA","text":"今日は晴れです。"}]]')
    await expect(createVoiceLanguageAgent(generate).annotate(['今天天气很好。'], new AbortController().signal)).rejects.toThrow('preserve')
  })

  it('rejects unsupported language codes', async () => {
    const generate = vi.fn<GenerateText>().mockResolvedValue('[[{"language":"auto","text":"了解。"}]]')
    await expect(createVoiceLanguageAgent(generate).annotate(['了解。'], new AbortController().signal)).rejects.toThrow()
  })

  it('does not call the model after cancellation', async () => {
    const generate = vi.fn<GenerateText>()
    await expect(createVoiceLanguageAgent(generate).annotate(['了解。'], AbortSignal.abort())).rejects.toThrow()
    expect(generate).not.toHaveBeenCalled()
  })
})
