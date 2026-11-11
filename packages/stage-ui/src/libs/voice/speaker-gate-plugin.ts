import type { VoicePlugin } from '@proj-airi/core-agent'

import { matchesOwnerVoice } from './speaker-recognition'

/**
 * Cancels automatic inputs without matching owner evidence before they become drafts or chat messages.
 * Install with both `input-control` and `cancel-input` grants. Manual controls bypass recognition.
 * The host captures admission per input, so settings changes cannot release an input that already requires recognition.
 */
export function createSpeakerGatePlugin(options: { required: (inputId: string) => boolean }): VoicePlugin {
  return {
    name: 'speaker-gate',
    setup(scope) {
      scope.onInput((input) => {
        if (!options.required(input.inputId))
          return
        if (!input.control)
          throw new Error('Speaker gate requires input control')
        const control = input.control
        input.finalize(({ document }) => {
          // Transcription freezes evidence before finalization. Missing or unfinished comparisons never grant access.
          if (matchesOwnerVoice(document.speakers) && document.raw.text.trim())
            return
          control.cancel('Speaker recognition did not match the enrolled voice')
        })
      })
    },
  }
}
