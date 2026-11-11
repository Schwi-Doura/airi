import type { SpeechAudio, SpeechOutput } from '@proj-airi/core-agent'
import type { PcmBlock } from '@proj-airi/pipelines-audio'

import { toFloat32FromPCM16 } from '@proj-airi/audio/encoding'
import { StreamingSpeechClient } from '@proj-airi/provider-inference'

/** The service owns sentence boundaries and hints. AIRI converts framed PCM and owns playback cancellation. */
export function createStreamingSpeechOutput(config: Record<string, unknown>, nowMs: () => number): Pick<Extract<SpeechOutput, { stream: unknown }>, 'stream'> {
  return {
    stream: async (text, signal) => new StreamingSpeechClient(config).stream(text, signal, nowMs).pipeThrough(new TransformStream({
      transform(sentence, output: TransformStreamDefaultController<SpeechAudio>) {
        const sourceId = crypto.randomUUID()
        let frame = 0
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
        let cancelled = false
        function releaseReader() {
          reader?.releaseLock()
          reader = undefined
        }
        // A TransformStream prefetches before playback owns the clip, which would credit unscheduled audio to the clock.
        const pcm = new ReadableStream<PcmBlock>({
          async pull(controller) {
            const input = reader ??= sentence.audio.getReader()
            try {
              const next = await input.read()
              if (cancelled)
                return
              if (next.done) {
                releaseReader()
                controller.close()
                return
              }
              const samples = toFloat32FromPCM16(next.value)
              controller.enqueue({ range: { sourceId, startFrame: frame, endFrame: frame + samples.length }, sampleRate: 44100, channels: [samples] })
              frame += samples.length
            }
            catch (cause) {
              releaseReader()
              if (!cancelled)
                controller.error(cause)
            }
          },
          async cancel(reason) {
            cancelled = true
            if (reader) {
              try {
                await reader.cancel(reason)
              }
              finally {
                releaseReader()
              }
            }
            else {
              await sentence.audio.cancel(reason)
            }
          },
        }, { highWaterMark: 0 })
        output.enqueue({ text: sentence.text, audio: pcm })
      },
    }), { signal }),
  }
}
