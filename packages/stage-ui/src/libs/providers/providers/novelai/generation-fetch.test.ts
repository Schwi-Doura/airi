import { describe, expect, it, vi } from 'vitest'

import { createGenerationFetch } from './generation-fetch'

describe('novelAI generation serialization', () => {
  it('holds the shared lock until the streamed body finishes, across transport instances', async () => {
    let finish: (() => void) | undefined
    const upstream = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(new ReadableStream({ start(stream) {
        stream.enqueue(new TextEncoder().encode('first'))
        finish = () => stream.close()
      } })))
      .mockResolvedValueOnce(new Response('second'))
    const first = await createGenerationFetch(upstream)('https://example.com/chat', { method: 'POST' })
    const text = first.text()
    const second = createGenerationFetch(upstream)('https://example.com/chat', { method: 'POST' })
    await new Promise<void>(resolve => setTimeout(resolve, 20))
    expect(upstream).toHaveBeenCalledTimes(1)
    finish?.()
    expect(await text).toBe('first')
    expect(await (await second).text()).toBe('second')
    expect(upstream).toHaveBeenCalledTimes(2)
  })

  it('does not issue an aborted queued request and releases a cancelled body', async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream()))
    const request = createGenerationFetch(upstream)
    const first = await request('https://example.com/chat', { method: 'POST' })
    const abort = new AbortController()
    const second = request('https://example.com/chat', { method: 'POST', signal: abort.signal })
    abort.abort(new Error('Stopped'))
    await expect(second).rejects.toThrow('Stopped')
    await first.body!.cancel()
    expect(upstream).toHaveBeenCalledOnce()
  })

  it('releases the slot after a network failure or a failed response body', async () => {
    const upstream = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('Network failed'))
      .mockResolvedValueOnce(new Response(new ReadableStream({ start(stream) {
        stream.error(new Error('Stream failed'))
      } })))
      .mockResolvedValueOnce(new Response('recovered'))
    const request = createGenerationFetch(upstream)
    await expect(request('https://example.com/chat')).rejects.toThrow('Network failed')
    const failed = await request('https://example.com/chat')
    await expect(failed.text()).rejects.toThrow('Stream failed')
    expect(await (await request('https://example.com/chat')).text()).toBe('recovered')
  })
})
