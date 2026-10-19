import { createPinia } from 'pinia'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h } from 'vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'

import SpeechProviderSettings from './speech-provider-settings.vue'

import { useSpeechStore } from '../../../stores/modules/speech'
import { useProvidersStore } from '../../../stores/providers'

/** @example describe('speech provider voice loading', () => {}) */
describe('speech provider voice loading', () => {
  /** @example it('loads NovelAI voices when configuration becomes ready after mounting', async () => {}) */
  it('loads NovelAI voices when configuration becomes ready after mounting', async () => {
    // ROOT CAUSE:
    // The page checked configuration only on mount. Asynchronous credential
    // validation could finish later, leaving the voice dropdown empty forever.
    // Observe provider readiness so the catalogue loads after validation finishes.
    // A cleared seed displayed Maria in the page but failed validation, so
    // exercise actual validation instead of force-configuring the provider.
    const pinia = createPinia()
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { render: () => null } }],
    })
    const screen = await render(defineComponent({
      setup() {
        const providers = useProvidersStore()
        const speech = useSpeechStore()
        providers.providers['novelai-speech'] = { apiKey: '', model: 'v2', seed: '' }
        speech.availableVoices = {}
        speech.activeSpeechProvider = 'speech-noop'
        return () => h(SpeechProviderSettings, { providerId: 'novelai-speech' }, {
          playground: () => h('output', { 'aria-label': 'Available voices' }, (speech.availableVoices['novelai-speech'] ?? []).map(voice => voice.name).join(', ')),
        })
      },
    }), {
      global: {
        directives: { motion: {} },
        plugins: [pinia, router, createI18n({ legacy: false, locale: 'en', missingWarn: false, fallbackWarn: false })],
      },
    })
    // @example expect(output).toHaveTextContent('')
    await expect.element(screen.getByRole('status', { name: 'Available voices' })).toBeEmptyDOMElement()

    const providers = useProvidersStore(pinia)
    providers.providers['novelai-speech'].apiKey = 'test-token'
    const configured = await providers.validateProvider('novelai-speech', { force: true })
    // @example expect(configured).toBe(true)
    expect(configured).toBe(true)

    // @example expect(output).toHaveTextContent('custom, Maria, Kayra, Clio')
    await expect.element(screen.getByRole('status', { name: 'Available voices' })).toHaveTextContent('custom, Maria, Kayra, Clio')
  })
})
