import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useArtistryStore } from '@proj-airi/stage-ui/stores/modules/artistry'
import { createPinia } from 'pinia'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, ref } from 'vue'
import { createI18n } from 'vue-i18n'

import CardCreationDialog from './CardCreationDialog.vue'

/** @example describe('character card artistry selection', () => {}) */
describe('character card artistry selection', () => {
  /** @example it('saves and restores a NovelAI provider override', async () => {}) */
  it('saves and restores a NovelAI provider override', async () => {
    // ROOT CAUSE:
    // The character editor maintained its own provider list without NovelAI,
    // so a configured image provider could not be selected for a character.
    const pinia = createPinia()
    const opened = ref(true)
    let cardId = ''
    const screen = await render(defineComponent({
      setup() {
        const cards = useAiriCardStore()
        const artistry = useArtistryStore()
        artistry.novelaiApiKey = 'test-token'
        artistry.globalProvider = 'none'
        cardId = cards.addCard({
          name: 'Artistry test',
          version: '1.0',
          description: 'Test character',
          personality: 'Friendly',
          scenario: 'A test scene',
          systemPrompt: 'Be helpful',
          postHistoryInstructions: 'Stay in character',
          greetings: [],
          messageExample: [],
        })
        return () => h(CardCreationDialog, {
          'modelValue': opened.value,
          'onUpdate:modelValue': (value: boolean) => opened.value = value,
          cardId,
          'initialTab': 'artistry',
        })
      },
    }), {
      global: {
        plugins: [pinia, createI18n({ legacy: false, locale: 'en', missingWarn: false, fallbackWarn: false })],
      },
    })
    await screen.getByRole('combobox').first().click()
    await screen.getByRole('option', { name: 'NovelAI Diffusion', exact: true }).click()
    await screen.getByRole('button', { name: 'settings.pages.card.save', exact: true }).click()
    // @example expect(card.extensions.airi.modules.artistry.provider).toBe('novelai')
    expect(useAiriCardStore(pinia).cards.get(cardId)?.extensions.airi.modules.artistry?.provider).toBe('novelai')

    opened.value = true
    // @example expect(providerSelection).toHaveTextContent('NovelAI Diffusion')
    await expect.element(screen.getByRole('combobox').first()).toHaveTextContent('NovelAI Diffusion')
  })
})
