import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, shallowRef } from 'vue'

import RadioCardSimple from './radio-card-simple.vue'

/** @example describe('provider radio selection', () => {}) */
describe('provider radio selection', () => {
  /** @example it('commits the provider before a click handler navigates away', async () => {}) */
  it('commits the provider before a click handler navigates away', async () => {
    // ROOT CAUSE:
    // Clicking the card label invokes navigation before the native radio's
    // default activation updates v-model. Pages can unmount with the old provider.
    // Updating the model at the component click boundary commits selection first.
    const selected = shallowRef('none')
    const selectionsAtNavigation: string[] = []
    const screen = await render(defineComponent({
      setup: () => () => h(RadioCardSimple, {
        'id': 'novelai',
        'name': 'artistry-provider',
        'value': 'novelai',
        'title': 'NovelAI Diffusion',
        'modelValue': selected.value,
        'onUpdate:modelValue': (value: string) => selected.value = value,
        'onClick': () => selectionsAtNavigation.push(selected.value),
      }),
    }))

    await screen.getByText('NovelAI Diffusion', { exact: true }).click()
    // @example expect(selectionsAtNavigation[0]).toBe('novelai')
    expect(selectionsAtNavigation[0]).toBe('novelai')
    // @example expect(selected.value).toBe('novelai')
    expect(selected.value).toBe('novelai')
  })

  /** @example it('does not select a provider when its action button stops the click', async () => {}) */
  it('does not select a provider when its action button stops the click', async () => {
    const selected = shallowRef('speech-noop')
    const screen = await render(defineComponent({
      setup: () => () => h(RadioCardSimple, {
        'id': 'novelai-speech',
        'name': 'speech-provider',
        'value': 'novelai-speech',
        'title': 'NovelAI TTS',
        'modelValue': selected.value,
        'onUpdate:modelValue': (value: string) => selected.value = value,
      }, {
        topRight: () => h('button', {
          type: 'button',
          onClick: (event: MouseEvent) => {
            event.stopPropagation()
            event.preventDefault()
          },
        }, 'Remove provider'),
      }),
    }))
    await screen.getByRole('button', { name: 'Remove provider' }).click()
    // @example expect(selected.value).toBe('speech-noop')
    expect(selected.value).toBe('speech-noop')
  })
})
