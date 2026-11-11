import type { InferOutput } from 'valibot'
import type { z } from 'zod'

import { errorMessageFrom } from '@moeru/std'
import { toWavFromPCM16 } from '@proj-airi/audio/encoding'
import { array, boolean, integer, literal, maxValue, minValue, nullable, number, object, parse, pipe, string } from 'valibot'

import { streamingSpeechConfigSchema } from './settings'

const idSchema = pipe(number(), integer(), minValue(1))
const healthSchema = object({ protocolVersion: literal(1), ready: boolean(), busy: boolean(), stage: string(), error: string(), sampleRate: literal(44100), channels: literal(1), encoding: literal('pcm_s16le') })
const modelSchema = object({ models: array(object({ id: string(), name: string() })) })
const voicesSchema = object({ voices: array(object({ id: string(), name: string(), languages: array(string()) })) })
const referenceSchema = object({ id: nullable(string()), name: string(), text: string() })
const referencesSchema = object({ references: array(object({ id: string(), name: string(), text: string() })) })
const textModelsSchema = object({ models: array(object({ id: string(), name: string() })), error: string() })
const envelopeSchema = object({ type: string() })
const preparedSchema = object({ id: idSchema, original: string(), normalized: string(), gapAfter: pipe(number(), minValue(0), maxValue(2)) })
const audioSchema = object({ id: idSchema, pcm: string(), bytes: pipe(number(), integer(), minValue(2)) })
const doneSchema = object({ id: idSchema, samples: pipe(number(), integer(), minValue(1)), rtf: pipe(number(), minValue(0)) })
/** One service sentence. Drain or cancel its audio before abandoning the response. */
export interface StreamingSpeechPart {
  readonly text: string
  /** Mono PCM16 at 44100 Hz, including the preceding inter-sentence pause. */
  readonly audio: ReadableStream<Uint8Array>
}

interface Sentence {
  readonly id: number
  readonly text: string
  readonly gapAfter: number
  readonly chunks: Uint8Array[]
  controller: ReadableStreamDefaultController<Uint8Array>
  wake?: () => void
  queued: number
  received: number
  done: boolean
  closed: boolean
  started: boolean
  rebufferUntilMs?: number
  prefix: Uint8Array | undefined
}

/**
 * Owns one socket, text reader, sentence queues, and cancellation signal.
 * Sentence IDs are scoped to this connection. A terminal event is required for success.
 * Abort, consumer cancellation, timeout, or premature close fails all owned audio streams.
 */
class SpeechSession {
  private readonly socket: WebSocket
  private readonly input: ReadableStreamDefaultReader<string>
  private output!: ReadableStreamDefaultController<StreamingSpeechPart>
  private readonly sentences = new Map<number, Sentence>()
  private readonly pending: StreamingSpeechPart[] = []
  private wake?: () => void
  private state: 'opening' | 'streaming' | 'complete' | 'failed' = 'opening'
  private failure?: Error
  private timer: ReturnType<typeof setTimeout> | undefined
  private lastSentenceId = 0
  private rtf = 1.16
  private queued = 0
  private inputRunning = false
  private inputReleased = false
  private feedbackTimer: ReturnType<typeof setInterval> | undefined
  private scheduledUntilMs = 0

  constructor(private readonly settings: z.output<typeof streamingSpeechConfigSchema>, text: ReadableStream<string>, private readonly signal: AbortSignal, private readonly playbackNowMs?: () => number) {
    this.input = text.getReader()
    const url = endpoint(settings.baseUrl, 'speech/stream')
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    this.socket = new WebSocket(url)
  }

  open(): ReadableStream<StreamingSpeechPart> {
    const stream = new ReadableStream<StreamingSpeechPart>({
      start: (output) => { this.output = output },
      pull: async (output) => {
        while (!this.pending.length && this.state !== 'complete' && this.state !== 'failed')
          await new Promise<void>((resolve) => { this.wake = resolve })
        if (this.failure)
          throw this.failure
        const next = this.pending.shift()
        if (next)
          output.enqueue(next)
        else
          output.close()
      },
      cancel: reason => this.fail(new Error('Speech consumer cancelled.', { cause: reason })),
    }, { highWaterMark: 0 })
    this.socket.addEventListener('open', () => {
      if (this.state !== 'opening')
        return
      this.state = 'streaming'
      // Explicit independent credentials apply to this connection, never to the service's persisted configuration.
      const textApi = this.settings.annotationEnabled
        ? { baseUrl: this.settings.annotationBaseUrl, model: this.settings.annotationModel, apiKey: this.settings.annotationApiKey }
        : undefined
      const multiSpeaker = this.settings.multiSpeakerEnabled && this.settings.model.startsWith('drama-3-')
      this.send({ type: 'start', protocolVersion: 1, model: this.settings.model, voice: this.settings.voice, ...(this.settings.referenceId ? { referenceId: this.settings.referenceId } : {}), ...(multiSpeaker ? { speakerReferences: this.settings.speakerReferences } : {}), annotationMode: 'server', annotation_enabled: this.settings.annotationEnabled, ...(textApi ? { textApi } : {}), merge_for_synthesis: this.settings.mergeForSynthesis, annotation_batch_size: this.settings.annotationBatchSize, gap: this.settings.gap, initial_buffer: this.settings.streamBufferMs / 1000, max_cache: this.settings.maxCacheSeconds, segmentation: this.settings.segmentation, stride: 32 })
      if (this.playbackNowMs) {
        // The producer can pause at its high-water mark. Report clock consumption even when no new audio arrives.
        this.feedbackTimer = setInterval(() => {
          this.feedback()
          for (const sentence of this.sentences.values())
            sentence.wake?.()
        }, 100)
      }
      void this.feed().catch(error => this.fail(error))
    })
    this.socket.addEventListener('message', (event) => {
      if (this.state !== 'streaming')
        return
      try {
        this.arm(120000)
        this.receive(JSON.parse(String(event.data)))
      }
      catch (error) {
        this.fail(error)
      }
    })
    this.socket.addEventListener('error', () => this.fail(new Error('Speech service connection failed.')))
    this.socket.addEventListener('close', () => {
      if (this.state !== 'complete' && this.state !== 'failed')
        this.fail(new Error('Speech service closed before synthesis completed.'))
    })
    this.signal.addEventListener('abort', this.abort, { once: true })
    this.arm(10000)
    if (this.signal.aborted)
      this.abort()
    return stream
  }

  private readonly abort = () => this.fail(new Error('Speech cancelled.', { cause: this.signal.reason }))

  private arm(ms: number) {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.fail(new Error('Speech service timed out.')), ms)
  }

  private send(value: Record<string, unknown>) {
    if (this.socket.readyState === WebSocket.OPEN)
      this.socket.send(JSON.stringify(value))
  }

  private feedback() {
    this.send({ type: 'buffer', seconds: this.queued / 88200 + this.headroomMs() / 1000 })
  }

  private headroomMs() {
    return this.playbackNowMs ? Math.max(0, this.scheduledUntilMs - this.playbackNowMs()) : 0
  }

  private handoff(bytes: Uint8Array, output: ReadableStreamDefaultController<Uint8Array>) {
    // Playback pulls one block at a time. Count its frames until the shared audio clock consumes them.
    // Complete-WAV previews have no playback clock and report only their network queue.
    if (this.playbackNowMs)
      this.scheduledUntilMs = Math.max(this.playbackNowMs(), this.scheduledUntilMs) + bytes.length / 88.2
    output.enqueue(bytes)
    this.feedback()
  }

  private async feed() {
    this.inputRunning = true
    try {
      while (this.state === 'streaming') {
        const next = await this.input.read()
        if (this.state !== 'streaming')
          return
        if (next.done) {
          this.send({ type: 'end' })
          return
        }
        if (next.value) {
          for (let offset = 0; offset < next.value.length; offset += 4000)
            this.send({ type: 'text', text: next.value.slice(offset, offset + 4000) })
        }
      }
    }
    finally {
      this.inputReleased = true
      this.input.releaseLock()
    }
  }

  private receive(raw: unknown) {
    const { type } = parse(envelopeSchema, raw)
    if (type === 'session') {
      parse(object({ sampleRate: literal(44100) }), raw)
    }
    else if ((!this.settings.mergeForSynthesis && type === 'prepared') || (this.settings.mergeForSynthesis && type === 'segments_merged')) {
      const value = parse(preparedSchema, raw)
      // Merged groups use their first source ID, so batch IDs increase without being consecutive.
      const expectedId = this.settings.mergeForSynthesis ? value.id > this.lastSentenceId : value.id === this.lastSentenceId + 1
      if (!expectedId)
        throw new Error('Speech service returned an invalid sentence sequence.')
      const previous = this.sentences.get(this.lastSentenceId)
      const sentence: Sentence = { id: value.id, text: value.normalized, gapAfter: value.gapAfter, chunks: [], controller: undefined!, queued: 0, received: 0, done: false, closed: false, started: false, prefix: previous ? new Uint8Array(Math.round(previous.gapAfter * 44100) * 2) : undefined }
      const audio = new ReadableStream<Uint8Array>({
        start: (output) => { sentence.controller = output },
        pull: output => this.pull(sentence, output),
        cancel: reason => this.fail(new Error('Speech audio cancelled.', { cause: reason })),
      }, { highWaterMark: 0 })
      this.lastSentenceId = value.id
      this.sentences.set(value.id, sentence)
      this.pending.push({ text: sentence.text, audio })
      this.wake?.()
    }
    else if (type === 'audio') {
      const value = parse(audioSchema, raw)
      const sentence = this.sentence(value.id)
      if (sentence.done)
        throw new Error('Audio arrived after its sentence ended.')
      const bytes = Uint8Array.from(atob(value.pcm), char => char.charCodeAt(0))
      if (bytes.length !== value.bytes || bytes.length % 2)
        throw new Error('Speech service returned invalid PCM16 audio.')
      sentence.chunks.push(bytes)
      sentence.queued += bytes.length
      sentence.received += bytes.length
      this.queued += bytes.length
      if (this.queued / 88200 + this.headroomMs() / 1000 > this.settings.maxCacheSeconds + 6)
        throw new Error('Speech service exceeded the audio queue limit.')
      sentence.wake?.()
      this.feedback()
    }
    else if (type === 'segment_done') {
      const value = parse(doneSchema, raw)
      const sentence = this.sentence(value.id)
      if (sentence.done || sentence.received !== value.samples * 2)
        throw new Error('Speech service returned an incomplete sentence.')
      sentence.done = true
      this.rtf = 0.7 * this.rtf + 0.3 * value.rtf
      sentence.wake?.()
    }
    else if (type === 'synthesis_done') {
      if ([...this.sentences.values()].some(sentence => !sentence.done))
        throw new Error('Speech service completed with unfinished sentences.')
      this.state = 'complete'
      clearTimeout(this.timer)
      clearInterval(this.feedbackTimer)
      this.wake?.()
      this.socket.close()
      this.releaseAbort()
    }
    else if (type === 'error') {
      throw new Error(parse(object({ message: string() }), raw).message)
    }
    // Diagnostic events do not own sentence or audio state.
  }

  private sentence(id: number) {
    const sentence = this.sentences.get(id)
    if (!sentence)
      throw new Error('Audio event has no prepared sentence.')
    return sentence
  }

  private async pull(sentence: Sentence, output: ReadableStreamDefaultController<Uint8Array>) {
    while (true) {
      if (this.failure)
        throw this.failure
      if (sentence.prefix?.length) {
        const silence = sentence.prefix
        sentence.prefix = undefined
        this.handoff(silence, output)
        return
      }
      const headroom = this.headroomMs()
      const buffering = this.playbackNowMs ? headroom <= 150 : !sentence.started
      const target = sentence.id === 1 && !sentence.started
        ? this.settings.streamBufferMs / 1000
        : Math.max(0.75, Math.min(4, 0.35 + Math.max(0, this.rtf - 1) * sentence.text.length / 5))
      if (this.playbackNowMs && sentence.started && buffering && sentence.chunks.length && sentence.rebufferUntilMs === undefined)
        sentence.rebufferUntilMs = this.playbackNowMs() + 1000
      const refillExpired = this.playbackNowMs && sentence.rebufferUntilMs !== undefined && this.playbackNowMs() >= sentence.rebufferUntilMs
      if (sentence.chunks.length && (!buffering || sentence.done || refillExpired || sentence.queued >= target * 88200)) {
        sentence.started = true
        sentence.rebufferUntilMs = undefined
        const next = sentence.chunks.shift()!
        sentence.queued -= next.length
        this.queued -= next.length
        this.handoff(next, output)
        return
      }
      if (sentence.done && !sentence.chunks.length) {
        sentence.closed = true
        output.close()
        this.releaseAbort()
        return
      }
      // An empty running sentence re-enters adaptive buffering before release.
      if (!this.playbackNowMs)
        sentence.started = false
      await new Promise<void>((resolve) => {
        sentence.wake = resolve
      })
    }
  }

  private releaseAbort() {
    if (this.state === 'complete' && [...this.sentences.values()].every(sentence => sentence.closed))
      this.signal.removeEventListener('abort', this.abort)
  }

  private fail(cause: unknown) {
    if (this.state === 'failed')
      return
    this.failure = cause instanceof Error ? cause : new Error(errorMessageFrom(cause) ?? 'Speech stream failed.')
    this.state = 'failed'
    clearTimeout(this.timer)
    clearInterval(this.feedbackTimer)
    this.signal.removeEventListener('abort', this.abort)
    this.send({ type: 'cancel' })
    this.socket.close()
    if (!this.inputReleased) {
      void this.input.cancel(this.failure).catch(() => {}).finally(() => {
        if (!this.inputRunning && !this.inputReleased) {
          this.inputReleased = true
          this.input.releaseLock()
        }
      })
    }
    for (const sentence of this.sentences.values()) {
      sentence.chunks.length = 0
      if (!sentence.closed)
        sentence.controller.error(this.failure)
      sentence.wake?.()
    }
    this.output.error(this.failure)
    this.wake?.()
  }
}

function endpoint(base: string, path: string) {
  return new URL(path, base.endsWith('/') ? base : `${base}/`)
}

/** Connects to the independent service without importing its text or model implementation. */
export class StreamingSpeechClient {
  readonly settings: z.output<typeof streamingSpeechConfigSchema>

  constructor(config: z.input<typeof streamingSpeechConfigSchema>) {
    this.settings = streamingSpeechConfigSchema.parse(config)
  }

  private async get(path: string, signal?: AbortSignal): Promise<unknown> {
    const response = await fetch(endpoint(this.settings.baseUrl, path), { signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(5000)]) })
    if (!response.ok)
      throw new Error(`Speech service returned HTTP ${response.status}.`)
    return response.json()
  }

  async health(signal?: AbortSignal): Promise<InferOutput<typeof healthSchema>> {
    return parse(healthSchema, await this.get('health', signal))
  }

  async models() {
    return parse(modelSchema, await this.get('models')).models
  }

  async voices(signal?: AbortSignal) {
    return parse(voicesSchema, await this.get('voices', signal)).voices
  }

  /** Lists models through the speech service without putting credentials in URLs. */
  async textModels(signal?: AbortSignal) {
    const response = await fetch(endpoint(this.settings.baseUrl, 'text-models'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: this.settings.annotationBaseUrl, model: this.settings.annotationModel, apiKey: this.settings.annotationApiKey }),
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15000)]),
    })
    if (!response.ok)
      throw new Error(`Text model request failed (HTTP ${response.status}).`)
    const catalog = parse(textModelsSchema, await response.json())
    if (catalog.error)
      throw new Error(catalog.error)
    return catalog.models
  }

  /** Reads saved transcript metadata without downloading reference audio. */
  async references(signal?: AbortSignal) {
    return parse(referencesSchema, await this.get('references', signal)).references
  }

  /** Reads one saved transcript without downloading reference audio. */
  async reference(id: string, signal?: AbortSignal) {
    return parse(referenceSchema, await this.get(`references/${encodeURIComponent(id)}`, signal))
  }

  /** Saves an immutable service-side recording. A source ID reuses audio when only its transcript changes. */
  async saveReference(value: { text: string, name?: string, audio?: string, sourceId?: string }, signal: AbortSignal) {
    const response = await fetch(endpoint(this.settings.baseUrl, 'references'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
      signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
    })
    if (!response.ok)
      throw new Error(`Reference upload failed (HTTP ${response.status}).`)
    return parse(referenceSchema, await response.json())
  }

  /**
   * Each call owns an isolated socket. Cancellation affects only that response.
   * Playback supplies its audio clock and pulls without prefetch to account for scheduled frames.
   * Complete-file consumers omit the clock and report only network queues.
   */
  stream(text: ReadableStream<string>, signal: AbortSignal, playbackNowMs?: () => number): ReadableStream<StreamingSpeechPart> {
    return new SpeechSession(this.settings, text, signal, playbackNowMs).open()
  }

  /** Uses the streaming protocol for previews and returns one WAV with service-defined pauses. */
  async synthesize(text: string, signal: AbortSignal): Promise<ArrayBuffer> {
    signal.throwIfAborted()
    const input = new ReadableStream<string>({ start(output) {
      output.enqueue(text)
      output.close()
    } })
    const chunks: Uint8Array[] = []
    for await (const sentence of this.stream(input, signal)) {
      for await (const bytes of sentence.audio)
        chunks.push(bytes)
    }
    const pcm = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
    let offset = 0
    for (const chunk of chunks) {
      pcm.set(chunk, offset)
      offset += chunk.length
    }
    if (!pcm.length)
      throw new Error('Speech service returned no audio.')
    return toWavFromPCM16(pcm, 44100)
  }
}
