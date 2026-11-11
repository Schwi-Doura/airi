import type { SpeechProviderWithExtraOptions } from '@xsai-ext/providers/utils'
import type { z } from 'zod'

import { errorMessageFrom } from '@moeru/std'
import { object, parse, string } from 'valibot'

import { defineProvider } from '../../registry'
import { StreamingSpeechClient } from './client'
import { STREAMING_SPEECH_MODEL, streamingSpeechConfigSchema } from './settings'

const requestSchema = object({ input: string(), model: string(), voice: string() })
type Config = z.input<typeof streamingSpeechConfigSchema>

export const providerStreamingSpeech = defineProvider<Config, 'streaming-speech'>({
  id: 'streaming-speech',
  name: 'Streaming Speech',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.streaming-speech.title'),
  description: 'Independent multilingual speech pipeline',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.streaming-speech.description'),
  tasks: ['text-to-speech'],
  requiresCredentials: false,
  icon: 'i-solar:soundwave-bold-duotone',
  // The provider form contract requires Zod. Network responses use Valibot.
  createProviderConfig: () => streamingSpeechConfigSchema,
  createProvider(config): SpeechProviderWithExtraOptions<string, Record<string, unknown>> {
    const settings = streamingSpeechConfigSchema.parse(config)
    return { speech: model => ({
      model,
      baseURL: settings.baseUrl,
      fetch: async (_url: RequestInfo | URL, init?: RequestInit) => {
        const request = parse(requestSchema, JSON.parse(String(init?.body)))
        const signal = init?.signal ?? new AbortController().signal
        signal.throwIfAborted()
        const client = new StreamingSpeechClient({ ...settings, model: request.model, voice: request.voice })
        return new Response(await client.synthesize(request.input, signal), { headers: { 'Content-Type': 'audio/wav' } })
      },
    }) }
  },
  validationRequiredWhen: config => Boolean(config.baseUrl?.trim()),
  validators: { validateConfig: [({ t }) => ({
    id: 'streaming-speech:check-service',
    name: t('settings.pages.providers.catalog.edit.validators.openai-compatible.check-config.title'),
    validator: async (config) => {
      try {
        const health = await new StreamingSpeechClient(config).health()
        if (!health.ready)
          throw new Error(health.error || health.stage)
        return { valid: true, errors: [], reason: '', reasonKey: '' }
      }
      catch (error) {
        return { valid: false, errors: [{ error }], reason: errorMessageFrom(error) ?? 'Speech service connection failed.', reasonKey: '' }
      }
    },
  })] },
  extraMethods: {
    listModels: async config => (await new StreamingSpeechClient(config).models()).map(model => ({
      ...model,
      provider: 'streaming-speech',
      contextLength: 0,
      deprecated: false,
    })),
    voiceCatalogConfig: config => ({ baseUrl: config.baseUrl }),
    listVoices: async (config, _provider, _model, signal) => (await new StreamingSpeechClient(config).voices(signal)).map(voice => ({
      ...voice,
      provider: 'streaming-speech',
      languages: voice.languages.map(code => ({ code, title: code })),
    })),
  },
})

export { STREAMING_SPEECH_MODEL, streamingSpeechConfigSchema }
