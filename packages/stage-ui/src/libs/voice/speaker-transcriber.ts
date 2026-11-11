import type { SpeakerEvidence, StreamingTranscriber, TranscriptionEvent } from '@proj-airi/core-agent'
import type { PcmBlock } from '@proj-airi/pipelines-audio'

import { matchesOwnerVoice } from './speaker-recognition'

/** Retains recent audio while the independent speaker model computes its score. This is not a recognition deadline. */
const VERIFICATION_BUFFER_MS = 5000

/**
 * Owns one input's transcription admission. Before approval, audio stays in a bounded local buffer.
 * Approval replays recent audio and continues streaming. An unmatched capture ends without opening a provider.
 * The host supplies evidence for this input only. Changing settings cannot approve an already protected input.
 */
export class SpeakerTranscriber implements StreamingTranscriber {
  private readonly admission = Promise.withResolvers<boolean>()
  private decision: boolean | undefined

  constructor(private readonly createTranscriber: () => StreamingTranscriber, readonly required: boolean) {
    if (!required)
      this.decide(true)
  }

  /** A matching speech window can open transcription once. Later evidence cannot reopen a rejected input. */
  observe(evidence: Pick<SpeakerEvidence, 'candidates' | 'voicedMs'>): void {
    if (matchesOwnerVoice(evidence))
      this.decide(true)
  }

  private decide(allowed: boolean) {
    if (this.decision !== undefined)
      return
    this.decision = allowed
    this.admission.resolve(allowed)
  }

  transcribe(request: Parameters<StreamingTranscriber['transcribe']>[0]): ReadableStream<TranscriptionEvent> {
    const lifetime = new AbortController()
    const signal = AbortSignal.any([request.signal, lifetime.signal])
    return new ReadableStream<TranscriptionEvent>({
      start: async (output) => {
        const reader = request.audio.getReader()
        const abort = () => {
          this.decide(false)
          void reader.cancel(signal.reason).catch(() => {})
        }
        signal.addEventListener('abort', abort, { once: true })
        const buffered: PcmBlock[] = []
        let bufferedMs = 0
        let pending: Promise<ReadableStreamReadResult<PcmBlock>> | undefined
        try {
          signal.throwIfAborted()
          const admitted = this.admission.promise.then(allowed => ({ kind: 'admission' as const, allowed }))
          while (this.decision !== true) {
            pending ??= reader.read()
            const next = this.decision === false
              ? { kind: 'audio' as const, result: await pending }
              : await Promise.race([pending.then(result => ({ kind: 'audio' as const, result })), admitted])
            signal.throwIfAborted()
            if (next.kind === 'admission') {
              if (next.allowed)
                break
              continue
            }
            pending = undefined
            if (next.result.done) {
              this.decide(false)
              // Empty transcription completes only after capture ends. The final speaker gate cancels the input.
              output.enqueue({ type: 'complete', revision: 0 })
              output.close()
              return
            }
            if (this.decision === false)
              continue
            const block = next.result.value
            bufferedMs += block.channels[0].length / block.sampleRate * 1000
            buffered.push(block)
            // Audio can run ahead of model inference. Trim retained audio without rejecting a later matching score.
            while (bufferedMs > VERIFICATION_BUFFER_MS) {
              const oldest = buffered[0]
              const removed = Math.min(oldest.channels[0].length, Math.ceil((bufferedMs - VERIFICATION_BUFFER_MS) * oldest.sampleRate / 1000))
              bufferedMs -= removed / oldest.sampleRate * 1000
              if (removed === oldest.channels[0].length) {
                buffered.shift()
              }
              else {
                buffered[0] = {
                  ...oldest,
                  range: { ...oldest.range, startFrame: oldest.range.startFrame + removed },
                  channels: oldest.channels.map(channel => channel.slice(removed)),
                }
              }
            }
          }
          signal.throwIfAborted()
          // A read that lost the admission race still owns the next block. Replay it after the retained prefix.
          const audio = new ReadableStream<PcmBlock>({
            start(controller) {
              for (const block of buffered)
                controller.enqueue(block)
              buffered.length = 0
            },
            async pull(controller) {
              const result = await (pending ?? reader.read())
              pending = undefined
              if (result.done)
                controller.close()
              else
                controller.enqueue(result.value)
            },
            cancel: reason => reader.cancel(reason),
          })
          const stream = this.createTranscriber().transcribe({ audio, signal })
          for await (const event of stream) {
            signal.throwIfAborted()
            output.enqueue(event)
          }
          output.close()
        }
        catch (error) {
          output.error(error)
        }
        finally {
          buffered.length = 0
          signal.removeEventListener('abort', abort)
          await reader.cancel().catch(() => {})
          reader.releaseLock()
        }
      },
      cancel: reason => lifetime.abort(reason),
    })
  }
}
