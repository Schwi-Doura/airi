import type { SpeakerVoiceprint } from '@sherpaw/speaker-diarization'

import type { VoiceEnrollmentState } from './use-voice-enrollment'

import { computed, onScopeDispose, shallowRef, watch } from 'vue'

import { holdCaptureLease } from '../libs/voice/capture-lease'
import { loadSpeakerTracker } from '../libs/voice/speaker-model'
import { meanSpeakerScore, SPEAKER_COMPARISON } from '../libs/voice/speaker-recognition'
import { VoiceEnrollment } from '../libs/voice/voice-enrollment'
import { useSettingsAudioDevice } from '../stores/settings/audio-device'
import { useVoiceprintStore } from '../stores/voiceprint'
import { SileroVad } from '../workers/vad/silero-vad'

async function compareVoiceprint(voiceprint: SpeakerVoiceprint, speech: Float32Array, sampleRate: number, signal: AbortSignal): Promise<number | undefined> {
  const tracker = await loadSpeakerTracker(signal)
  try {
    const speaker = await tracker.enrollVoiceprint(voiceprint)
    signal.throwIfAborted()
    const scores = await tracker.similarity(speech, sampleRate, speaker, {
      windowSeconds: SPEAKER_COMPARISON.windowMs / 1000,
      stepSeconds: SPEAKER_COMPARISON.hopMs / 1000,
    })
    signal.throwIfAborted()
    return meanSpeakerScore(scores)
  }
  finally {
    tracker.dispose()
  }
}

/**
 * Records a settings test using enrollment's speech capture, without saving a voiceprint or creating a chat input.
 * The capture lease pauses the voice host during recording. Cancellation and scope disposal discard pending results.
 */
export function useVoiceprintTest() {
  const devices = useSettingsAudioDevice()
  const voiceprints = useVoiceprintStore()
  const state = shallowRef<VoiceEnrollmentState>({ phase: 'idle' })
  const score = shallowRef<number>()
  const busy = computed(() => state.value.phase === 'recording' || state.value.phase === 'enrolling')
  let recording: VoiceEnrollment | undefined

  function begin(): boolean {
    const voiceprint = voiceprints.voiceprint
    if (busy.value || !voiceprint)
      return false
    score.value = undefined
    const lease = new AbortController()
    holdCaptureLease(lease.signal)
    const vad = new SileroVad()
    // VoiceEnrollment owns bounded speech capture. Its callback compares instead of saving a new enrollment here.
    const current = new VoiceEnrollment(devices.input, {
      detect: (window, signal) => vad.score(window, signal),
      enroll: async (speech, sampleRate, signal) => {
        const result = await compareVoiceprint(voiceprint, speech, sampleRate, signal)
        signal.throwIfAborted()
        score.value = result
      },
    })
    recording = current
    const stop = current.subscribe(() => {
      state.value = current.snapshot
      if (current.snapshot.phase !== 'recording')
        lease.abort('Voiceprint test recording ended')
    })
    state.value = current.snapshot
    void current.done.finally(() => {
      stop()
      lease.abort('Voiceprint test ended')
      void vad.close()
      if (recording === current)
        recording = undefined
    })
    return true
  }

  function finish(): void {
    recording?.finish()
  }

  function cancel(): void {
    recording?.cancel()
  }

  // Deletion or re-enrollment invalidates both a pending test and its displayed result.
  watch(() => voiceprints.record, () => {
    cancel()
    state.value = { phase: 'idle' }
    score.value = undefined
  })
  onScopeDispose(cancel)

  return { state, score, busy, begin, finish, cancel }
}
