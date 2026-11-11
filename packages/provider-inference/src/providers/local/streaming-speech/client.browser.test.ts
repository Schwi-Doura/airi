import { afterEach, describe, expect, it, vi } from 'vitest'

import { StreamingSpeechClient } from './client'

const requests: Record<string, unknown>[] = []

/** Emulates the independent service boundary with source events followed by synthesized output. */
class SpeechService extends EventTarget {
  static readonly OPEN = 1
  readonly readyState = 1
  private merged = false

  constructor() {
    super()
    queueMicrotask(() => this.dispatchEvent(new Event('open')))
  }

  send(data: string) {
    const packet = JSON.parse(data)
    if (packet.type === 'start') {
      requests.push(packet)
      this.merged = packet.merge_for_synthesis
    }
    if (packet.type !== 'end')
      return
    queueMicrotask(() => {
      const emit = (value: object) => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) }))
      emit({ type: 'session', sampleRate: 44100 })
      if (this.merged) {
        for (let id = 1; id <= 5; id++)
          emit({ type: 'prepared', id, original: 'source', normalized: 'source', gapAfter: 0 })
      }
      for (const [index, id] of (this.merged ? [1, 4] : [1, 2]).entries()) {
        emit({ type: this.merged ? 'segments_merged' : 'prepared', id, original: `part ${index}`, normalized: `part ${index}`, gapAfter: 0.1 })
        emit({ type: 'audio', id, pcm: btoa(String.fromCharCode(index + 1, 0)), bytes: 2 })
        emit({ type: 'segment_done', id, samples: 1, rtf: 1 })
      }
      emit({ type: 'synthesis_done' })
    })
  }

  close() {}
}

describe('independent speech protocol', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    requests.length = 0
  })

  it.each([false, true])('plays outputs with one pause between them, merged=%s', async (merged) => {
    vi.stubGlobal('WebSocket', SpeechService)
    const client = new StreamingSpeechClient({ mergeForSynthesis: merged, referenceId: 'none', annotationEnabled: false, annotationBatchSize: 3, gap: 0.1 })
    const input = new ReadableStream<string>({
      start(output) {
        output.enqueue('one two three four five')
        output.close()
      },
    })
    const parts: { text: string, bytes: number[] }[] = []
    for await (const part of client.stream(input, new AbortController().signal)) {
      const bytes: number[] = []
      for await (const chunk of part.audio)
        bytes.push(...chunk)
      parts.push({ text: part.text, bytes })
    }
    expect(parts.map(part => part.text)).toEqual(['part 0', 'part 1'])
    expect(parts[0]!.bytes).toEqual([1, 0])
    expect(parts[1]!.bytes).toHaveLength(8822)
    expect(parts[1]!.bytes.slice(0, 8820).every(byte => byte === 0)).toBe(true)
    expect(parts[1]!.bytes.slice(-2)).toEqual([2, 0])
    expect(requests[0]).toMatchObject({ merge_for_synthesis: merged, annotation_batch_size: 3, annotation_enabled: false, referenceId: 'none', gap: 0.1, segmentation: { min_length: 1 } })
    expect(requests[0]).not.toHaveProperty('annotation_schedule')
  })

  it('loads empty reference metadata without treating the missing recording as an error', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ id: null, name: 'Model voice', text: '' })))
    const reference = await new StreamingSpeechClient({}).reference('default')
    expect(reference.id).toBeNull()
    expect(reference.text).toBe('')
  })

  it.each(['drama-3-q3', 's2-pro'])('sends speaker bindings only for Drama, model=%s', async (model) => {
    vi.stubGlobal('WebSocket', SpeechService)
    const speakerReferences = { 0: 'none', 1: `ref-${'a'.repeat(24)}` }
    await new StreamingSpeechClient({ model, multiSpeakerEnabled: true, speakerReferences, annotationEnabled: false }).synthesize('Hello', new AbortController().signal)
    if (model.startsWith('drama-3-'))
      expect(requests[0]).toHaveProperty('speakerReferences', speakerReferences)
    else
      expect(requests[0]).not.toHaveProperty('speakerReferences')
  })

  it('lists saved reference voices with their names and transcripts', async () => {
    const references = [{ id: `ref-${'a'.repeat(24)}`, name: 'Alice', text: 'Hello' }]
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ references })))
    expect(await new StreamingSpeechClient({}).references()).toEqual(references)
  })
})
