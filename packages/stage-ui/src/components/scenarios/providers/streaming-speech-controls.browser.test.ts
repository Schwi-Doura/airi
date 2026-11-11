import en from '@proj-airi/i18n/locales/en'

import { PiniaColada } from '@pinia/colada'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { createI18n } from 'vue-i18n'

import StreamingSpeechControls from './streaming-speech-controls.vue'

import { useProviderConfigStore } from '../../../stores/providers/config'

import 'virtual:uno.css'

let pinia = createPinia()

beforeEach(() => {
  pinia = createPinia()
})

afterEach(() => {
  cleanup()
  disposePinia(pinia)
  vi.unstubAllGlobals()
  localStorage.clear()
})

it('saves batch synthesis without annotation and allows a voice without reference audio', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input) => {
    if (String(input).includes('/text-models'))
      return Response.json({ models: [{ id: 'glm-4-6', name: 'GLM' }], error: '' })
    if (String(input).endsWith('/references'))
      return Response.json({ references: [] })
    if (String(input).includes('/references/'))
      return Response.json({ id: null, name: 'Model voice', text: '' })
    return Response.json({ protocolVersion: 1, ready: true, busy: false, stage: 'ready', error: '', sampleRate: 44100, channels: 1, encoding: 'pcm_s16le' })
  }))
  await page.viewport(1000, 1200)
  await render(StreamingSpeechControls, {
    global: { plugins: [pinia, PiniaColada, createI18n({ legacy: false, locale: 'en', messages: { en } })] },
  })
  const configs = useProviderConfigStore(pinia)
  configs.ensureProvider('streaming-speech', 'streaming-speech')
  await page.getByRole('button', { name: 'Check connection / Refresh models' }).click()
  await expect.element(page.getByText('Connection succeeded. Found 1 models.')).toBeVisible()
  await page.getByRole('switch', { name: /Merge each batch/ }).click()
  await expect.poll(() => configs.getProviderConfig('streaming-speech')?.mergeForSynthesis).toBe(true)
  await page.getByRole('switch', { name: /Enable speech annotation/ }).click()
  await expect.poll(() => configs.getProviderConfig('streaming-speech')?.annotationEnabled).toBe(false)
  await expect.element(page.getByText('Pause between synthesized batches. No extra pause is added inside a batch.')).toBeVisible()
  await page.getByRole('button', { name: 'Use model voice without reference' }).click()
  await expect.poll(() => configs.getProviderConfig('streaming-speech')?.referenceId).toBe('none')
  await expect.element(page.getByText('Annotation execution', { exact: true })).not.toBeInTheDocument()
  await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
})

it('saves Drama speaker bindings and disables the controls for S2 without deleting them', async () => {
  const referenceId = `ref-${'a'.repeat(24)}`
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input) => {
    if (String(input).endsWith('/references'))
      return Response.json({ references: [{ id: referenceId, name: 'Alice', text: 'Hello' }] })
    if (String(input).includes('/references/'))
      return Response.json({ id: null, name: 'Model voice', text: '' })
    return Response.json({ protocolVersion: 1, ready: true, busy: false, stage: 'ready', error: '', sampleRate: 44100, channels: 1, encoding: 'pcm_s16le' })
  }))
  const configs = useProviderConfigStore(pinia)
  configs.ensureProvider('streaming-speech', 'streaming-speech')
  await configs.patchProviderConfig('streaming-speech', { model: 'drama-3-q3' })
  await render(StreamingSpeechControls, {
    global: { plugins: [pinia, PiniaColada, createI18n({ legacy: false, locale: 'en', messages: { en } })] },
  })
  await page.getByRole('switch', { name: 'Enable multiple speakers' }).click()
  await expect.poll(() => configs.getProviderConfig('streaming-speech')?.multiSpeakerEnabled).toBe(true)
  await page.getByRole('button', { name: 'Add speaker', exact: true }).click()
  await page.getByRole('combobox', { name: 'Speaker 1', exact: true }).click()
  await page.getByRole('option', { name: 'Alice', exact: true }).click()
  await expect.poll(() => configs.getProviderConfig('streaming-speech')?.speakerReferences).toEqual({ 0: 'none', 1: referenceId })
  await configs.patchProviderConfig('streaming-speech', { model: 's2-pro' })
  await expect.element(page.getByRole('switch', { name: 'Enable multiple speakers' })).toBeDisabled()
  expect(configs.getProviderConfig('streaming-speech')?.speakerReferences).toEqual({ 0: 'none', 1: referenceId })
})
