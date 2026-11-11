import { StreamingSpeechClient, streamingSpeechConfigSchema } from '@proj-airi/provider-inference'
import { onScopeDispose } from 'vue'

import { useProviderConfigStore } from '../../../../stores/providers/config'

/** Uses service-owned annotation for previews and cancels requests when settings close. */
export function useStreamingSpeechPreview() {
  const configs = useProviderConfigStore()
  let pending: AbortController | undefined
  onScopeDispose(() => pending?.abort(new Error('Speech preview closed')))

  async function generateSpeech(text: string, voice: string, model?: string): Promise<ArrayBuffer> {
    pending?.abort(new Error('Speech preview replaced'))
    const settings = streamingSpeechConfigSchema.parse({ ...configs.getProviderConfig('streaming-speech'), voice, ...(model ? { model } : {}) })
    const controller = new AbortController()
    pending = controller
    try {
      return await new StreamingSpeechClient(settings).synthesize(text, controller.signal)
    }
    finally {
      if (pending === controller)
        pending = undefined
    }
  }
  return { generateSpeech }
}
