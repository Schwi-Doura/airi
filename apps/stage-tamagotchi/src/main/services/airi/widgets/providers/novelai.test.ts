import { describe, expect, it, vi } from 'vitest'

import { NovelAIProvider } from './novelai'

/** @example describe('NovelAI Artistry', () => {}) */
describe('novelai artistry', () => {
  /** @example it('prepends configured positive prompts and merges negative prompts in V5 requests', async () => {}) */
  it('prepends configured positive prompts and merges negative prompts in V5 requests', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ images: [{ image: 'cG5n' }] }))
    const provider = new NovelAIProvider(fetcher)
    await provider.initialize({ novelaiApiKey: 'token', novelaiModel: 'nai-diffusion-5-full', novelaiPromptPrefix: ' high quality, watercolor ', novelaiNegativePrompt: ' blurry, watermark ' })
    await provider.generate({ prompt: ' a dragon ', negativePrompt: ' noise ' })
    const body: unknown = JSON.parse(String(fetcher.mock.calls[0][1]?.body))
    // @example expect(body).toHaveProperty('input', 'high quality, watercolor, a dragon')
    expect(body).toHaveProperty('input', 'high quality, watercolor, a dragon')
    // @example expect(body).toHaveProperty('parameters.negative_prompt', 'blurry, watermark, noise')
    expect(body).toHaveProperty('parameters.negative_prompt', 'blurry, watermark, noise')
    // @example expect(body).toHaveProperty('parameters.v4_prompt.caption.base_caption', 'high quality, watercolor, a dragon')
    expect(body).toHaveProperty('parameters.v4_prompt.caption.base_caption', 'high quality, watercolor, a dragon')
    // @example expect(body).toHaveProperty('parameters.v4_negative_prompt.caption.base_caption', 'blurry, watermark, noise')
    expect(body).toHaveProperty('parameters.v4_negative_prompt.caption.base_caption', 'blurry, watermark, noise')

    await provider.initialize({ novelaiApiKey: 'token' })
    await provider.generate({ prompt: 'a fox' })
    const cleared: unknown = JSON.parse(String(fetcher.mock.calls[1][1]?.body))
    // @example expect(cleared).toHaveProperty('input', 'a fox')
    expect(cleared).toHaveProperty('input', 'a fox')
    // @example expect(cleared).toHaveProperty('parameters.negative_prompt', '')
    expect(cleared).toHaveProperty('parameters.negative_prompt', '')
  })

  /** @example it('requests native JSON images and returns a completed Artistry job', async () => {}) */
  it('requests native JSON images and returns a completed Artistry job', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ images: [{ image: 'cG5n' }] }, { status: 201 }))
    const provider = new NovelAIProvider(fetcher)
    await provider.initialize({ novelaiApiKey: 'token', novelaiModel: 'nai-diffusion-3' })
    const job = await provider.generate({ prompt: 'a dragon', width: 832, height: 1216, negativePrompt: 'blurry', extra: { parameters: { seed: 42, steps: 20 } } })
    const [url, init] = fetcher.mock.calls[0]
    // @example expect(url.toString()).toBe('https://image.novelai.net/ai/generate-image')
    expect(url.toString()).toBe('https://image.novelai.net/ai/generate-image')
    // @example expect(new Headers(init?.headers).get('Accept')).toBe('application/json')
    expect(new Headers(init?.headers).get('Accept')).toBe('application/json')
    // @example expect(JSON.parse(String(init?.body))).toMatchObject({ action: 'generate' })
    expect(JSON.parse(String(init?.body))).toMatchObject({ input: 'a dragon', action: 'generate', model: 'nai-diffusion-3', parameters: { seed: 42, steps: 20, negative_prompt: 'blurry', n_samples: 1 } })
    // @example await expect(provider.getStatus(job.jobId)).resolves.toMatchObject({ status: 'succeeded' })
    await expect(provider.getStatus(job.jobId)).resolves.toMatchObject({ status: 'succeeded', imageUrl: 'data:image/png;base64,cG5n' })
  })

  /** @example it('builds structured captions for V4 models', async () => {}) */
  it('builds structured captions for V4 models', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ images: [{ image: 'cG5n' }] }))
    const provider = new NovelAIProvider(fetcher)
    await provider.initialize({ novelaiApiKey: 'token' })
    await provider.generate({ prompt: 'a dragon', model: 'nai-diffusion-4-full' })
    const body: unknown = JSON.parse(String(fetcher.mock.calls[0][1]?.body))
    // @example expect(body).toHaveProperty('parameters.v4_prompt.caption.base_caption', 'a dragon')
    expect(body).toHaveProperty('parameters.v4_prompt.caption.base_caption', 'a dragon')
  })

  /** @example it('propagates errors without exposing tokens or retrying', async () => {}) */
  it('propagates errors without exposing tokens or retrying', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('error', { status: 429 }))
    const provider = new NovelAIProvider(fetcher)
    await provider.initialize({ novelaiApiKey: 'secret' })
    // @example await expect(provider.generate({ prompt: 'dragon' })).rejects.toThrow('HTTP 429')
    await expect(provider.generate({ prompt: 'dragon' })).rejects.toThrow('HTTP 429')
    // @example expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  /** @example it('rejects missing credentials and empty image responses', async () => {}) */
  it('rejects missing credentials and empty image responses', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ images: [] }))
    const provider = new NovelAIProvider(fetcher)
    // @example await expect(provider.generate({ prompt: 'dragon' })).rejects.toThrow('Token is required')
    await expect(provider.generate({ prompt: 'dragon' })).rejects.toThrow('Token is required')
    // @example expect(fetcher).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
    await provider.initialize({ novelaiApiKey: 'token' })
    // @example await expect(provider.generate({ prompt: 'dragon' })).rejects.toThrow('no image')
    await expect(provider.generate({ prompt: 'dragon' })).rejects.toThrow('no image')
  })
})
