import { describe, expect, it } from 'vitest'

import { createChatProvider } from './chat'

describe('completion budget for NovelAI', () => {
  it.each([
    { requested: undefined, expected: 2048 },
    { requested: 128, expected: 128 },
  ])('sends $expected tokens when the caller requests $requested', async ({ requested, expected }) => {
    const requests: Record<string, unknown>[] = []
    const provider = createChatProvider({
      apiKey: 'test',
      baseUrl: 'https://example.test/oa/v1/',
      fetch: async (_input, init) => {
        requests.push(JSON.parse(String(init?.body)))
        return Response.json({ choices: [{ index: 0, text: '{}', finish_reason: 'stop' }] })
      },
    })
    const config = provider.chat('glm-4-6')
    const response = await config.fetch!(new URL('https://example.test/oa/v1/chat/completions'), {
      body: JSON.stringify({ model: 'glm-4-6', messages: [{ role: 'user', content: 'Return JSON.' }], max_tokens: requested }),
    })
    await response.json()

    expect(requests).toHaveLength(1)
    expect(requests[0].max_tokens).toBe(expected)
  })
})
