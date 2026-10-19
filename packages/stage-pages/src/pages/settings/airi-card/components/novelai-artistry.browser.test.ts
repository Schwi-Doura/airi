import en from '@proj-airi/i18n/locales/en'

import { PiniaColada } from '@pinia/colada'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'

import CardEditor from './CardEditor.vue'

import 'virtual:uno.css'

describe('novelai card artistry selection', () => {
  const pinia = createPinia()

  afterEach(() => {
    cleanup()
    disposePinia(pinia)
    localStorage.clear()
  })

  it('offers NovelAI in the upstream card editor', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { template: '<div />' } }],
    })
    await router.push('/')
    await page.viewport(1200, 1000)
    const screen = await render(CardEditor, {
      props: { initialSection: 'artistry' },
      global: {
        plugins: [pinia, PiniaColada, router, createI18n({ legacy: false, locale: 'en', messages: { en } })],
      },
    })

    await screen.getByRole('button', { name: 'Artistry', exact: true }).first().click()
    // The shared identity header contains the display-model combobox first.
    const provider = screen.getByRole('combobox').nth(1)
    await provider.click()
    const novelai = page.getByRole('option', { name: 'NovelAI Diffusion', exact: true })
    await expect.element(novelai).toBeVisible()
    await novelai.click()
    await expect.element(provider).toHaveTextContent('NovelAI Diffusion')
  })
})
