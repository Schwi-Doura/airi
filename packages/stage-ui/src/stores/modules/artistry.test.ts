import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { resolveArtistryConfigFromStore, useArtistryStore } from './artistry'

/**
 * @example
 * describe('artistry store', () => {})
 */
describe('artistry store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  /**
   * @example
   * it('defaults to disabled artistry without treating ComfyUI as configured', () => {})
   */
  it('defaults to disabled artistry without treating ComfyUI as configured', () => {
    const artistryStore = useArtistryStore()

    // @example
    expect(artistryStore.globalProvider).toBe('none')
    // @example
    expect(artistryStore.activeProvider).toBe('none')
    // @example
    expect(artistryStore.configured).toBe(false)
  })

  /** @example it('syncs and resets NovelAI configuration', () => {}) */
  it('syncs and resets NovelAI configuration', () => {
    const store = useArtistryStore()
    store.globalProvider = 'novelai'
    store.activeProvider = 'novelai'
    // @example expect(store.configured).toBe(false)
    expect(store.configured).toBe(false)
    store.novelaiApiKey = 'token'
    store.novelaiModel = 'nai-diffusion-3'
    store.novelaiPromptPrefix = 'watercolor'
    store.novelaiNegativePrompt = 'blurry'
    // @example expect(store.configured).toBe(true)
    expect(store.configured).toBe(true)
    // @example expect(resolveArtistryConfigFromStore(store).globals).toMatchObject({ novelaiApiKey: 'token' })
    expect(resolveArtistryConfigFromStore(store).globals).toMatchObject({ novelaiApiKey: 'token', novelaiModel: 'nai-diffusion-3', novelaiPromptPrefix: 'watercolor', novelaiNegativePrompt: 'blurry' })
    // @example expect(store.artistryGlobals).toMatchObject({ novelaiPromptPrefix: 'watercolor', novelaiNegativePrompt: 'blurry' })
    expect(store.artistryGlobals).toMatchObject({ novelaiPromptPrefix: 'watercolor', novelaiNegativePrompt: 'blurry' })
    store.resetState()
    // @example expect(store.novelaiApiKey).toBe('')
    expect(store.novelaiApiKey).toBe('')
    // @example expect(store.novelaiPromptPrefix).toBe('')
    expect(store.novelaiPromptPrefix).toBe('')
    // @example expect(store.novelaiNegativePrompt).toBe('')
    expect(store.novelaiNegativePrompt).toBe('')
    // @example expect(store.configured).toBe(false)
    expect(store.configured).toBe(false)
  })
})
