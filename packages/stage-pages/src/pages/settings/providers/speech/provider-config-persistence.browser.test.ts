import en from '@proj-airi/i18n/locales/en'

import { PiniaColada } from '@pinia/colada'
import { toWavFromPCM16 } from '@proj-airi/audio/encoding'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'

import CometApiSpeechPage from './comet-api-speech.vue'
import CosyVoice3Page from './cosyvoice3.vue'
import IndexTtsPage from './index-tts-vllm.vue'
import NovelAISpeechPage from './novelai-speech.vue'
import OpenAICompatibleSpeechPage from './openai-compatible-audio-speech.vue'

import 'virtual:uno.css'

const providerId = 'openai-compatible-audio-speech'

describe('speech provider configuration persistence', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    localStorage.clear()
    pinia = createPinia()
    // The form must accept credentials before a TTS server is reachable.
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => {
      throw new TypeError('TTS server unavailable')
    }))
  })

  async function renderPage(component = OpenAICompatibleSpeechPage) {
    await page.viewport(1100, 1100)
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { template: '<div />' } }],
    })
    await router.push('/')
    return await render(component, {
      global: {
        plugins: [pinia, PiniaColada, router, createI18n({ legacy: false, locale: 'en', messages: { en } })],
        directives: { motion: {} },
      },
    })
  }

  afterEach(() => {
    disposePinia(pinia)
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('saves a CosyVoice3 recording, transcript, and instruction mode across page reopen', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ paths: {
      '/inference_zero_shot': {},
      '/inference_cross_lingual': {},
      '/inference_instruct2': {},
    } })))
    const screen = await renderPage(CosyVoice3Page)
    await expect.element(screen.getByRole('textbox', { name: /API Key Input/ })).not.toBeInTheDocument()
    await expect.element(screen.getByText('Use Custom SSML', { exact: true })).not.toBeInTheDocument()
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    if (!input)
      throw new Error('Missing reference recording input')
    const transfer = new DataTransfer()
    transfer.items.add(new File([toWavFromPCM16(new Uint8Array([0, 0]), 16000)], 'unicorn.wav', { type: 'audio/wav' }))
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    const configs = useProviderConfigStore(pinia)
    await expect.poll(() => configs.getProviderConfig('cosyvoice3')?.referenceName).toBe('unicorn.wav')
    await screen.getByRole('textbox', { name: /Reference transcript/ }).fill('参考音频的原文。')
    await expect.poll(() => configs.getProviderConfig('cosyvoice3')?.referenceText).toBe('参考音频的原文。')
    await screen.getByRole('combobox').first().click()
    await page.getByRole('option', { name: 'Voice cloning with instructions', exact: true }).click()
    await screen.getByRole('textbox', { name: /Speech instruction/ }).fill('请用愉快的语气说日语。')
    await expect.poll(() => configs.getProviderConfig('cosyvoice3')?.instruction).toBe('请用愉快的语气说日语。')
    await expect.poll(() => useSpeechStore(pinia).availableVoices.cosyvoice3?.map(voice => voice.id)).toEqual(['reference'])
    await expect.poll(() => configs.configuredProviders.cosyvoice3).toBe(true)
    expect(configs.getProviderConfig('cosyvoice3')?.model).toBe('Fun-CosyVoice3-0.5B-2512')
    screen.unmount()
    const reopened = await renderPage(CosyVoice3Page)
    await expect.element(reopened.getByRole('textbox', { name: /Speech instruction/ })).toHaveValue('请用愉快的语气说日语。')
    expect(configs.getProviderConfig('cosyvoice3')?.referenceAudio).toMatch(/^data:audio\/wav;base64,/)
  })

  it('persists Japanese for local IndexTTS without an API key', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ 'official-demo': {} })))
    const screen = await renderPage(IndexTtsPage)
    await expect.element(screen.getByRole('textbox', { name: /API Key Input/ })).not.toBeInTheDocument()
    await screen.getByRole('combobox').first().click()
    await page.getByRole('option', { name: '日本語', exact: true }).click()
    await expect.poll(() => useProviderConfigStore(pinia).getProviderConfig('index-tts-vllm')?.language).toBe('JA')
    expect(useProviderConfigStore(pinia).getProviderConfig('index-tts-vllm')?.model).toBe('IndexTTS-2.5')
    screen.unmount()
    const reopened = await renderPage(IndexTtsPage)
    await expect.element(reopened.getByRole('combobox').first()).toHaveTextContent('日本語')
  })

  it('saves IndexTTS emotion and speed controls and hides unsupported SSML', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ 'official-demo': {} })))
    const screen = await renderPage(IndexTtsPage)
    await expect.element(screen.getByText('Speaking speed', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('Extra sentence pause', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('Extra paragraph pause', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('Use Custom SSML', { exact: true })).not.toBeInTheDocument()
    await screen.getByRole('combobox').nth(1).click()
    await page.getByRole('option', { name: 'Manual emotion', exact: true }).click()
    await expect.element(screen.getByText('Emotion strength', { exact: true })).toBeVisible()
    await screen.getByRole('combobox').nth(2).click()
    await page.getByRole('option', { name: 'Calm', exact: true }).click()
    const slider = screen.getByRole('slider').first()
    await slider.click()
    await userEvent.keyboard('{Home}{ArrowRight}')
    const config = useProviderConfigStore(pinia)
    await expect.poll(() => config.getProviderConfig('index-tts-vllm')?.emotionMode).toBe('manual')
    await expect.poll(() => config.getProviderConfig('index-tts-vllm')?.emotion).toBe('calm')
    await expect.poll(() => config.getProviderConfig('index-tts-vllm')?.speed).toBe(0.55)
    screen.unmount()
    const reopened = await renderPage(IndexTtsPage)
    await expect.element(reopened.getByRole('combobox').nth(1)).toHaveTextContent('Manual emotion')
    await expect.element(reopened.getByRole('combobox').nth(2)).toHaveTextContent('Calm')
    expect(config.getProviderConfig('index-tts-vllm')?.speed).toBe(0.55)
  })

  // NovelAI has a local voice catalogue. Entering credentials must load it even
  // when validation finishes after the settings component has mounted.
  it('loads NovelAI voices after entering credentials and keeps them on reopen', async () => {
    const screen = await renderPage(NovelAISpeechPage)
    await page.getByPlaceholder('Persistent API Token').fill('novelai-test-token')
    await expect.element(screen.getByRole('button', { name: 'Test Voice', exact: true }), { timeout: 5000 }).toBeEnabled()
    await screen.getByRole('combobox').last().click()
    await expect.element(page.getByRole('option', { name: 'Clio', exact: true })).toBeVisible()
    await page.getByRole('option', { name: 'Clio', exact: true }).click()

    expect(useProviderConfigStore(pinia).getProviderConfig('novelai-speech')?.apiKey).toBe('novelai-test-token')
    screen.unmount()
    const reopened = await renderPage(NovelAISpeechPage)
    await expect.element(reopened.getByRole('button', { name: 'Test Voice', exact: true }), { timeout: 5000 }).toBeEnabled()
    await reopened.getByRole('combobox').last().click()
    await expect.element(page.getByRole('option', { name: 'Clio', exact: true })).toBeVisible()
  })

  // ROOT CAUSE:
  //
  // The immediate model watcher creates an entry in the computed configs map.
  // initializeProvider sees that entry and skips creation of the persisted provider.
  // Input changes then mutate a plain object, so the playground keeps its cached
  // missing-key state and localStorage stays empty. These tests fail if the page
  // and initialization flow stop writing through the provider store.
  // https://github.com/moeru-ai/airi/issues/2449
  it('enables Test Voice after the user enters an API key (Issue #2449)', async () => {
    const screen = await renderPage()

    const testVoice = screen.getByRole('button', { name: 'Test Voice', exact: true })
    await expect.element(testVoice).toBeDisabled()
    await page.getByPlaceholder('sk-...').fill('issue-2449-test-key')
    await expect.element(testVoice, { timeout: 1500 }).toBeEnabled()
    await expect.element(screen.getByText('Please enter an API key to test the voice.')).not.toBeInTheDocument()
    expect(useProviderConfigStore(pinia).getProviderConfig(providerId)?.apiKey).toBe('issue-2449-test-key')
  })

  // https://github.com/moeru-ai/airi/issues/2449
  it('persists a key entered on a fresh settings page (Issue #2449)', async () => {
    await renderPage()
    await page.getByPlaceholder('sk-...').fill('issue-2449-test-key')

    await expect.poll(() => {
      const stored = localStorage.getItem('settings/providers/configured')
      if (!stored)
        return undefined
      return JSON.parse(stored)[providerId]?.config?.apiKey
    }, { timeout: 2000 }).toBe('issue-2449-test-key')
  })

  // https://github.com/moeru-ai/airi/issues/2449#issuecomment-5586964144
  it('accepts the reported workaround with a persisted provider (Issue #2449)', async () => {
    localStorage.setItem('settings/providers/configured', JSON.stringify({
      [providerId]: {
        id: providerId,
        definitionId: providerId,
        config: { apiKey: 'issue-2449-test-key', baseUrl: 'http://127.0.0.1:8080/v1/', model: 'qwen', voice: 'assistant' },
        status: 'unconfigured',
        configuredBy: 'user',
      },
    }))
    const screen = await renderPage()
    await expect.element(screen.getByRole('button', { name: 'Test Voice', exact: true })).toBeEnabled()
    expect(useProviderConfigStore(pinia).getProviderConfig(providerId)?.apiKey).toBe('issue-2449-test-key')
  })

  // https://github.com/moeru-ai/airi/issues/2449
  it('enables Comet API Test Voice after the user enters an API key (Issue #2449)', async () => {
    const screen = await renderPage(CometApiSpeechPage)

    const testVoice = screen.getByRole('button', { name: 'Test Voice', exact: true })
    await expect.element(testVoice).toBeDisabled()
    await page.getByPlaceholder('API Key').fill('issue-2449-comet-key')
    await expect.element(testVoice, { timeout: 1500 }).toBeEnabled()
  })

  // https://github.com/moeru-ai/airi/issues/2449
  it('persists a Comet API key entered on a fresh settings page (Issue #2449)', async () => {
    await renderPage(CometApiSpeechPage)
    await page.getByPlaceholder('API Key').fill('issue-2449-comet-key')

    await expect.poll(() => {
      const stored = localStorage.getItem('settings/providers/configured')
      if (!stored)
        return undefined
      return JSON.parse(stored)['comet-api-speech']?.config?.apiKey
    }, { timeout: 2000 }).toBe('issue-2449-comet-key')
  })
})
