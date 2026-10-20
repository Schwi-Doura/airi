import type { MaybeRefOrGetter } from 'vue'

import { computed, defineAsyncComponent, toValue } from 'vue'

import { useIndexTtsPreview } from './index-tts/preview'

const controls = {
  'index-tts-vllm': defineAsyncComponent(() => import('../../../components/scenarios/providers/index-tts-controls.vue')),
  'cosyvoice3': defineAsyncComponent(() => import('../../../components/scenarios/providers/cosyvoice3-controls.vue')),
}

/** Provider controls replace shared prosody fields. Preview work belongs to the current settings view. */
export function useSpeechProviderPresentation(providerId: MaybeRefOrGetter<string>) {
  const indexTts = useIndexTtsPreview()
  const features = {
    'index-tts-vllm': { controls: controls['index-tts-vllm'], rawSSML: false, preview: indexTts.generateSpeech },
    'cosyvoice3': { controls: controls.cosyvoice3, rawSSML: false, preview: undefined },
  }
  const defaults = Object.freeze({ controls: undefined, rawSSML: true, preview: undefined })
  return computed(() => features[toValue(providerId) as keyof typeof features] ?? defaults)
}
