import type { SpeechProviderWithExtraOptions } from '@xsai-ext/providers/utils'

import type { IndexTtsSpeechOptions } from './settings'

import { errorMessageFrom } from '@moeru/std'
import { z } from 'zod'

import { defineProvider } from '../../registry'
import { indexTtsEmotions, indexTtsSettingsSchema } from './settings'

type IndexTtsConfig = z.input<typeof indexTtsSettingsSchema>

function voicesUrl(config: IndexTtsConfig) {
  return `${config.baseUrl ?? 'http://localhost:11996/tts/'}audio/voices`
}

export const providerIndexTtsVllm = defineProvider<IndexTtsConfig, 'index-tts-vllm'>({
  id: 'index-tts-vllm',
  name: 'Index-TTS by Bilibili',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.index-tts-vllm.title'),
  description: 'index-tts.github.io',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.index-tts-vllm.description'),
  tasks: ['text-to-speech'],
  requiresCredentials: false,
  iconColor: 'i-lobe-icons:bilibiliindex',
  createProviderConfig: () => indexTtsSettingsSchema,
  createProvider(config): SpeechProviderWithExtraOptions<string, IndexTtsSpeechOptions> {
    return {
      speech: (model, options) => ({
        baseURL: config.baseUrl ?? 'http://localhost:11996/tts/',
        model,
        // Sentence annotation overrides the saved default, including kanji-only Japanese.
        fetch: (input: RequestInfo | URL, init?: RequestInit) => {
          const body: unknown = JSON.parse(String(init?.body))
          const request = z.object({ model: z.string(), input: z.string(), voice: z.string() }).passthrough().parse(body)
          const settings = indexTtsSettingsSchema.parse({ ...config, ...options })
          const emotion = settings.emotion
          const vector = settings.emotionMode === 'manual' && emotion !== 'neutral' && settings.emotionIntensity > 0
            ? indexTtsEmotions.map(name => name === emotion ? settings.emotionIntensity : 0)
            : undefined
          return globalThis.fetch(input, {
            ...init,
            body: JSON.stringify({
              ...request,
              language: settings.language,
              duration_factor: 1 / settings.speed,
              emo_vector: vector,
              pause_after_ms: z.number().int().min(0).max(3000).parse(options?.pauseAfterMs ?? 0),
            }),
          })
        },
      }),
    }
  },
  validationRequiredWhen: config => Boolean(config.baseUrl?.trim()),
  validators: {
    validateConfig: [
      ({ t }) => ({
        id: 'index-tts-vllm:check-config',
        name: t('settings.pages.providers.catalog.edit.validators.openai-compatible.check-config.title'),
        validator: async (config) => {
          const baseUrl = config.baseUrl?.trim() ?? ''
          if (!baseUrl) {
            const reason = 'Base URL is required. Default to http://localhost:11996/tts/ for Index-TTS.'
            return { errors: [{ error: new Error(reason) }], reason, reasonKey: '', valid: false }
          }

          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 5000)
          try {
            const response = await fetch(voicesUrl(config), { signal: controller.signal })
            if (!response.ok) {
              const reason = `IndexTTS unreachable: HTTP ${response.status} ${response.statusText}`
              return { errors: [{ error: new Error(reason) }], reason, reasonKey: '', valid: false }
            }
          }
          catch (error) {
            const reason = `IndexTTS connection failed: ${errorMessageFrom(error) ?? 'Unknown error'}`
            return { errors: [{ error }], reason, reasonKey: '', valid: false }
          }
          finally {
            clearTimeout(timeout)
          }

          return { errors: [], reason: '', reasonKey: '', valid: true }
        },
      }),
    ],
  },
  extraMethods: {
    listModels: async () => [{
      id: 'IndexTTS-2.5',
      name: 'IndexTTS-2.5',
      provider: 'index-tts-vllm',
      description: 'Local multilingual voice cloning with IndexTTS-2.5',
      contextLength: 0,
      deprecated: false,
    }],
    voiceCatalogConfig: ({ baseUrl }) => ({ baseUrl }),
    listVoices: async (config) => {
      const response = await fetch(voicesUrl(config))
      if (!response.ok)
        throw new Error(`Failed to fetch voices: ${response.statusText}`)

      const voices = await response.json() as Record<string, unknown>
      return Object.keys(voices).map(voice => ({
        id: voice,
        name: voice,
        provider: 'index-tts-vllm',
        languages: [
          { code: 'zh', title: 'Chinese' },
          { code: 'en', title: 'English' },
          { code: 'ja', title: 'Japanese' },
          { code: 'es', title: 'Spanish' },
          { code: 'ar', title: 'Arabic' },
        ],
      }))
    },
  },
})
