import type { SpeechProvider } from '@xsai-ext/providers/utils'

import { z } from 'zod'

import { ProviderValidationCheck } from '../../types'
import { createOpenAICompatibleValidators } from '../../validators'
import { defineProvider } from '../registry'
import { createChatProvider } from './chat'

const chatBaseUrl = 'https://text.novelai.net/oa/v1/'
const speechBaseUrl = 'https://api.novelai.net/'

const credentialsSchema = z.object({
  apiKey: z.string().trim().min(1),
  baseUrl: z.url(),
})

const speechConfigSchema = credentialsSchema.extend({
  baseUrl: z.url().default(speechBaseUrl),
  // Clearing the optional seed uses Maria, matching the settings page and TTS request.
  seed: z.string().trim().transform(seed => seed || 'Maria').default('Maria'),
})

/**
 * Registers NovelAI's text-only OpenAI-compatible chat interface.
 *
 * Use when:
 * - Selecting NovelAI in Consciousness or the provider catalogue.
 *
 * Expects:
 * - A Persistent API Token and a model returned by the account's model endpoint.
 *
 * Returns:
 * - A chat/model provider with text-based tool calls translated for xsAI.
 */
export const providerNovelAI = defineProvider({
  id: 'novelai',
  name: 'NovelAI',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.novelai.title'),
  description: 'NovelAI text generation using a Persistent API Token.',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.novelai.description'),
  tasks: ['chat'],
  icon: 'i-solar:book-bold-duotone',
  createProviderConfig: ({ t }) => credentialsSchema.extend({
    apiKey: credentialsSchema.shape.apiKey.meta({
      labelLocalized: t('settings.pages.providers.provider.novelai.token'),
      type: 'password',
    }),
    baseUrl: z.url().default(chatBaseUrl),
  }),
  createProvider(config) {
    return createChatProvider({ apiKey: config.apiKey ?? '', baseUrl: config.baseUrl || chatBaseUrl })
  },
  validationRequiredWhen: config => !!config.apiKey?.trim(),
  validators: createOpenAICompatibleValidators({
    // Model discovery is sufficient for background validation and never generates text.
    checks: [ProviderValidationCheck.Connectivity, ProviderValidationCheck.ModelList],
  }),
})

/**
 * Registers NovelAI TTS v1/v2 using the native voice generation endpoint.
 *
 * Use when:
 * - Selecting NovelAI for Speech synthesis or voice previews.
 *
 * Expects:
 * - A Persistent API Token; voice IDs are seed strings or `custom` for the configured seed.
 *
 * Returns:
 * - An xsAI speech adapter returning the upstream audio without re-encoding.
 */
export const providerNovelAISpeech = defineProvider<z.input<typeof speechConfigSchema>, 'novelai-speech'>({
  id: 'novelai-speech',
  name: 'NovelAI TTS',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.novelai-speech.title'),
  description: 'NovelAI TTS v1/v2 with custom voice seeds (no voice cloning).',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.novelai-speech.description'),
  tasks: ['text-to-speech'],
  icon: 'i-solar:user-speak-rounded-bold-duotone',
  createProviderConfig: ({ t }) => speechConfigSchema.extend({
    apiKey: credentialsSchema.shape.apiKey.meta({
      labelLocalized: t('settings.pages.providers.provider.novelai.token'),
      type: 'password',
    }),
    seed: speechConfigSchema.shape.seed.meta({
      labelLocalized: t('settings.pages.providers.provider.novelai-speech.seed'),
      descriptionLocalized: t('settings.pages.providers.provider.novelai-speech.seed-description'),
    }),
  }),
  createProvider(config): SpeechProvider {
    const settings = speechConfigSchema.parse(config)
    return {
      speech: model => ({
        baseURL: settings.baseUrl,
        model,
        fetch: (_input: RequestInfo | URL, init?: RequestInit) => {
          const body: unknown = JSON.parse(String(init?.body))
          const request = z.object({
            input: z.string().min(1),
            model: z.enum(['v1', 'v2']),
            voice: z.string().optional(),
          }).parse(body)
          const seed = !request.voice || request.voice === 'custom'
            ? settings.seed
            : request.voice
          return globalThis.fetch(new URL('ai/generate-voice', settings.baseUrl), {
            ...init,
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${settings.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              text: request.input,
              seed,
              voice: -1,
              opus: false,
              version: request.model,
            }),
          })
        },
      }),
    }
  },
  extraMethods: {
    listModels: async () => ['v1', 'v2'].map(id => ({ id, name: `TTS ${id}`, provider: 'novelai-speech' })),
    listVoices: async () => ['custom', 'Maria', 'Kayra', 'Clio'].map(id => ({
      id,
      name: id,
      provider: 'novelai-speech',
      languages: [],
    })),
  },
  validationRequiredWhen: config => !!config.apiKey?.trim(),
  validators: {
    validateConfig: [({ t }) => ({
      id: 'novelai-speech:config',
      name: 'NovelAI TTS configuration',
      validator: (config) => {
        const result = speechConfigSchema.safeParse(config)
        return {
          valid: result.success,
          errors: result.success ? [] : [{ error: result.error }],
          reason: result.success ? '' : t('settings.pages.providers.provider.novelai-speech.invalid-config'),
          reasonKey: 'settings.pages.providers.provider.novelai-speech.invalid-config',
        }
      },
    })],
  },
})
