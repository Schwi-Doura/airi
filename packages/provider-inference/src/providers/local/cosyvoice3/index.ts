import type { SpeechProviderWithExtraOptions } from '@xsai-ext/providers/utils'

import { errorMessageFrom } from '@moeru/std'
import { toWavFromPCM16 } from '@proj-airi/audio/encoding'
import { literal, minLength, object, parse, pipe, string, trim } from 'valibot'
import { z } from 'zod'

import { defineProvider } from '../../registry'

/** The native service must load the ordinary llm.pt checkpoint for this model. */
export const COSYVOICE3_MODEL = 'Fun-CosyVoice3-0.5B-2512'

/** Persisted reference recording and synthesis controls for the official FastAPI service. */
export const cosyVoice3ConfigSchema = z.object({
  baseUrl: z.url().default('http://127.0.0.1:50000/'),
  model: z.literal(COSYVOICE3_MODEL).default(COSYVOICE3_MODEL),
  referenceAudio: z.string().default(''),
  referenceName: z.string().default(''),
  referenceText: z.string().default(''),
  mode: z.enum(['zero-shot', 'cross-lingual', 'instruct']).default('zero-shot'),
  instruction: z.string().default(''),
})

type Config = z.input<typeof cosyVoice3ConfigSchema>

const requestSchema = object({
  model: literal(COSYVOICE3_MODEL),
  input: pipe(string(), trim(), minLength(1)),
  voice: literal('reference'),
})

const apiSchema = object({ paths: object({
  '/inference_zero_shot': object({}),
  '/inference_cross_lingual': object({}),
  '/inference_instruct2': object({}),
}) })

function endpoint(baseUrl: string, path: string) {
  return new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
}

function referenceRecording(audio: string): Blob {
  const match = /^data:audio\/(?:wav|x-wav|wave|vnd\.wave);base64,([A-Z0-9+/=]+)$/i.exec(audio)
  if (!match)
    throw new Error('Upload a WAV reference recording.')
  const bytes = Uint8Array.from(atob(match[1]), character => character.charCodeAt(0))
  if (bytes.byteLength > 2 * 1024 * 1024)
    throw new Error('The reference recording exceeds 2 MiB.')
  const signature = new TextDecoder().decode(bytes.subarray(0, 12))
  if (!signature.startsWith('RIFF') || signature.slice(8) !== 'WAVE')
    throw new Error('The reference recording is not a WAV file.')
  return new Blob([bytes], { type: 'audio/wav' })
}

function validateReference(config: z.output<typeof cosyVoice3ConfigSchema>) {
  referenceRecording(config.referenceAudio)
  if (config.mode === 'zero-shot' && !config.referenceText.trim())
    throw new Error('Enter the exact transcript of the reference recording.')
  if (config.mode === 'instruct' && !config.instruction.trim())
    throw new Error('Enter a speech instruction.')
}

export const providerCosyVoice3 = defineProvider<Config, 'cosyvoice3'>({
  id: 'cosyvoice3',
  name: 'CosyVoice3',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.cosyvoice3.title'),
  description: 'Local multilingual voice cloning with CosyVoice3',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.cosyvoice3.description'),
  tasks: ['text-to-speech'],
  requiresCredentials: false,
  icon: 'i-solar:soundwave-bold-duotone',
  // Provider metadata currently requires a Zod schema. Wire payloads use Valibot.
  createProviderConfig: () => cosyVoice3ConfigSchema,
  createProvider(config): SpeechProviderWithExtraOptions<string, Record<string, unknown>> {
    const settings = cosyVoice3ConfigSchema.parse(config)
    return { speech: model => ({
      model,
      baseURL: settings.baseUrl,
      fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
        init?.signal?.throwIfAborted()
        const request = parse(requestSchema, JSON.parse(String(init?.body)))
        validateReference(settings)
        const recording = referenceRecording(settings.referenceAudio)
        const sentences = new Intl.Segmenter(undefined, { granularity: 'sentence' })
        const chunks: Uint8Array[] = []
        // Separate sentence contexts without splitting Japanese kana and kanji into isolated fragments.
        for (const { segment } of sentences.segment(request.input)) {
          const text = segment.trim()
          if (!text)
            continue
          init?.signal?.throwIfAborted()
          const form = new FormData()
          form.set('tts_text', text)
          form.set('prompt_wav', recording, 'reference.wav')
          let route = 'inference_zero_shot'
          if (settings.mode === 'zero-shot') {
            form.set('prompt_text', `You are a helpful assistant.<|endofprompt|>${settings.referenceText.trim()}`)
          }
          else if (settings.mode === 'cross-lingual') {
            route = 'inference_cross_lingual'
            form.set('tts_text', `You are a helpful assistant.<|endofprompt|>${text}`)
          }
          else {
            route = 'inference_instruct2'
            form.set('instruct_text', `You are a helpful assistant. ${settings.instruction.trim()}<|endofprompt|>`)
          }
          const response = await globalThis.fetch(endpoint(settings.baseUrl, route), {
            method: 'POST',
            body: form,
            signal: init?.signal,
          })
          if (!response.ok)
            return response
          const bytes = new Uint8Array(await response.arrayBuffer())
          init?.signal?.throwIfAborted()
          if (!bytes.length || bytes.length % 2 !== 0)
            throw new Error('CosyVoice3 returned empty or incomplete PCM16 audio.')
          chunks.push(bytes)
        }
        // Concatenate native PCM before adding one WAV header. Embedded headers corrupt playback between sentences.
        const pcm = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.byteLength, 0))
        let offset = 0
        for (const chunk of chunks) {
          pcm.set(chunk, offset)
          offset += chunk.byteLength
        }
        return new Response(toWavFromPCM16(pcm, 24000), { headers: { 'Content-Type': 'audio/wav' } })
      },
    }) }
  },
  validationRequiredWhen: config => Boolean(config.referenceAudio),
  validators: { validateConfig: [({ t }) => ({
    id: 'cosyvoice3:check-config',
    name: t('settings.pages.providers.catalog.edit.validators.openai-compatible.check-config.title'),
    validator: async (config) => {
      try {
        const settings = cosyVoice3ConfigSchema.parse(config)
        validateReference(settings)
        const response = await fetch(endpoint(settings.baseUrl, 'openapi.json'), { signal: AbortSignal.timeout(5000) })
        if (!response.ok)
          throw new Error(`CosyVoice3 connection failed: HTTP ${response.status}`)
        parse(apiSchema, await response.json())
        return { valid: true, errors: [], reason: '', reasonKey: '' }
      }
      catch (error) {
        return { valid: false, errors: [{ error }], reason: errorMessageFrom(error) ?? 'CosyVoice3 connection failed.', reasonKey: '' }
      }
    },
  })] },
  extraMethods: {
    listModels: async () => [{
      id: COSYVOICE3_MODEL,
      name: 'CosyVoice3 0.5B (2512)',
      provider: 'cosyvoice3',
      description: 'Ordinary llm.pt weights. Start the matching local service.',
      contextLength: 0,
      deprecated: false,
    }],
    voiceCatalogConfig: config => ({ referenceAudio: config.referenceAudio, referenceName: config.referenceName }),
    listVoices: async (config) => {
      if (!config.referenceAudio)
        return []
      referenceRecording(config.referenceAudio)
      return [{
        id: 'reference',
        name: config.referenceName || 'Reference voice',
        provider: 'cosyvoice3',
        languages: [{ code: 'zh', title: 'Chinese' }, { code: 'ja', title: 'Japanese' }, { code: 'en', title: 'English' }],
      }]
    },
  },
})
