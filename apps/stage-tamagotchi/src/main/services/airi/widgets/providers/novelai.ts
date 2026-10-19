import type { ArtistryJob, ArtistryJobStatus, ArtistryProvider, ArtistryRequest } from './base'

import { array, integer, maxValue, minValue, number, object, optional, parse, pipe, string } from 'valibot'

const imageResponseSchema = object({
  images: array(object({ image: string() })),
})

const parametersSchema = object({
  steps: optional(pipe(number(), integer(), minValue(1), maxValue(50)), 28),
  scale: optional(pipe(number(), minValue(0), maxValue(10)), 5),
  sampler: optional(string(), 'k_euler_ancestral'),
  seed: optional(pipe(number(), integer(), minValue(0), maxValue(4294967295))),
})

/**
 * Generates images through NovelAI's native Artistry API.
 *
 * Use when:
 * - The Artistry module selects NovelAI on desktop.
 *
 * Expects:
 * - A Persistent API Token and a valid image model ID.
 * - Text-to-image requests; advanced native parameters may be supplied in `extra`.
 *
 * Returns:
 * - Completed jobs whose image URLs contain the base64 PNG returned by NovelAI.
 */
export class NovelAIProvider implements ArtistryProvider {
  readonly id = 'novelai'
  readonly name = 'NovelAI Diffusion'
  private apiKey = ''
  private baseUrl = 'https://image.novelai.net/'
  private model = 'nai-diffusion-3'
  private promptPrefix = ''
  private negativePrompt = ''
  private jobs = new Map<string, ArtistryJobStatus>()

  constructor(private readonly fetcher: typeof fetch = globalThis.fetch) {}

  async initialize(config: Record<string, unknown>): Promise<void> {
    this.apiKey = typeof config.novelaiApiKey === 'string' ? config.novelaiApiKey.trim() : ''
    this.baseUrl = typeof config.novelaiBaseUrl === 'string' ? config.novelaiBaseUrl : 'https://image.novelai.net/'
    this.model = typeof config.novelaiModel === 'string' ? config.novelaiModel : 'nai-diffusion-3'
    this.promptPrefix = typeof config.novelaiPromptPrefix === 'string' ? config.novelaiPromptPrefix.trim() : ''
    this.negativePrompt = typeof config.novelaiNegativePrompt === 'string' ? config.novelaiNegativePrompt.trim() : ''
  }

  async generate(request: ArtistryRequest): Promise<ArtistryJob> {
    if (!this.apiKey)
      throw new Error('NovelAI Persistent API Token is required.')

    const model = request.model || this.model
    const extra = request.extra || {}
    if (extra.image)
      throw new Error('NovelAI Artistry currently supports text-to-image only.')

    // Apply provider-wide prompts at the request boundary so headless, widget,
    // and character-card generation all receive the same settings exactly once.
    const prompt = [this.promptPrefix, request.prompt.trim()].filter(Boolean).join(', ')
    const negativePrompt = [this.negativePrompt, request.negativePrompt?.trim()].filter(Boolean).join(', ')
    const parameters = parse(parametersSchema, extra.parameters || {})
    const response = await this.fetcher(new URL('ai/generate-image', this.baseUrl), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        // Request JSON explicitly so image handling needs no ZIP dependency.
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        input: prompt,
        model,
        action: 'generate',
        parameters: {
          params_version: 3,
          width: request.width ?? 832,
          height: request.height ?? 1216,
          n_samples: 1,
          noise_schedule: 'native',
          negative_prompt: negativePrompt,
          ...(model.startsWith('nai-diffusion-4') || model.startsWith('nai-diffusion-5')
            ? {
                v4_prompt: { caption: { base_caption: prompt, char_captions: [] }, use_coords: false, use_order: true },
                v4_negative_prompt: { caption: { base_caption: negativePrompt, char_captions: [] } },
              }
            : {}),
          ...parameters,
          seed: parameters.seed ?? Math.floor(Math.random() * 4294967296),
        },
      }),
    })
    if (!response.ok)
      throw new Error(`NovelAI image generation failed (HTTP ${response.status}).`)

    const payload: unknown = await response.json()
    const image = parse(imageResponseSchema, payload).images[0]?.image
    if (!image)
      throw new Error('NovelAI returned no image.')

    const jobId = typeof extra.internalJobId === 'string' ? extra.internalJobId : crypto.randomUUID()
    // The bridge polls completed jobs more than once. Keep a bounded recent history.
    if (this.jobs.size >= 32) {
      const oldest = this.jobs.keys().next().value
      if (oldest)
        this.jobs.delete(oldest)
    }
    this.jobs.set(jobId, { status: 'succeeded', progress: 100, imageUrl: `data:image/png;base64,${image}` })
    return { jobId, providerJobId: jobId }
  }

  async getStatus(jobId: string): Promise<ArtistryJobStatus> {
    return this.jobs.get(jobId) || { status: 'failed', error: 'Unknown NovelAI job.' }
  }

  dispose(): void {
    this.jobs.clear()
  }
}
