import { z } from 'zod'

import { ProviderValidationCheck } from '../../types'
import { createOpenAICompatibleValidators } from '../../validators'
import { defineProvider } from '../registry'
import { createChatProvider } from './chat'

const chatBaseUrl = 'https://text.novelai.net/oa/v1/'

const credentialsSchema = z.object({
  apiKey: z.string().trim().min(1),
  baseUrl: z.url(),
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
