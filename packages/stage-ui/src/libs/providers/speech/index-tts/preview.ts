import type { IndexTtsSpeechOptions } from '@proj-airi/provider-inference'
import type { SpeechProviderWithExtraOptions } from '@xsai-ext/providers/utils'

import { indexTtsSettingsSchema } from '@proj-airi/provider-inference'
import { onScopeDispose } from 'vue'

import { useTextGeneration } from '../../../../composables/text-generation'
import { useAudioContext } from '../../../../stores/audio'
import { useConsciousnessStore } from '../../../../stores/modules/consciousness'
import { useProviderConfigStore } from '../../../../stores/providers/config'
import { useProviderStore } from '../../../../stores/providers/provider'
import { createIndexTtsSpeech } from './synthesis'

/** Uses the chat synthesis path for IndexTTS previews, cancelling work when its view closes. */
export function useIndexTtsPreview() {
  const providers = useProviderStore()
  const configs = useProviderConfigStore()
  const consciousness = useConsciousnessStore()
  const textGeneration = useTextGeneration()
  const audio = useAudioContext()
  let pending: AbortController | undefined
  onScopeDispose(() => pending?.abort(new Error('Speech preview closed')))

  async function generateSpeech(text: string, voice: string, model?: string): Promise<ArrayBuffer> {
    pending?.abort(new Error('Speech preview replaced'))
    const controller = new AbortController()
    pending = controller
    const settings = indexTtsSettingsSchema.parse({ ...configs.getProviderConfig('index-tts-vllm'), ...(model ? { model } : {}) })
    const generateText = consciousness.activeProvider && consciousness.activeModel
      ? textGeneration.generateText({ providerId: consciousness.activeProvider, model: consciousness.activeModel })
      : undefined
    const provider = providers.getProviderInstance<SpeechProviderWithExtraOptions<string, IndexTtsSpeechOptions>>('index-tts-vllm')
    try {
      return await createIndexTtsSpeech(provider, settings, voice, generateText).preview(text, audio.audioContext, controller.signal)
    }
    finally {
      if (pending === controller)
        pending = undefined
    }
  }
  return { generateSpeech }
}
