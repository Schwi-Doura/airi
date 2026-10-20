import type { GenerateText } from '@proj-airi/agents'
import type { SpeechOutput } from '@proj-airi/core-agent'
import type { TextSegment, TextToken } from '@proj-airi/pipelines-audio'
import type { IndexTtsSettings } from '@proj-airi/provider-inference'

import type { LanguageSpan, SpeechLanguage } from './annotation'

import { indexTtsSettingsSchema } from '@proj-airi/provider-inference'

import { createVoiceLanguageAgent } from './annotation'

/**
 * Keeps complete sentences for multilingual synthesis and preserves ordered controls.
 *
 * Use when:
 * - IndexTTS needs sentence languages instead of guesses on short kanji clauses.
 *
 * Expects:
 * - Speech text after Markdown conversion; auto mode requires the character's chat model.
 *
 * Returns:
 * - A response-owned segmenter. Auto mode labels the entire response in one model request.
 *   Fixed-language mode skips that request. Neither mode changes displayed chat text.
 */
export function createLanguageSegmenter(language: string, generateText?: GenerateText, controls?: Partial<IndexTtsSettings>): NonNullable<SpeechOutput['segmenter']> {
  if (language !== 'auto' && language !== 'ZH' && language !== 'JA' && language !== 'EN' && language !== 'ES' && language !== 'AR')
    throw new Error(`Unsupported speech language: ${language}`)
  const fixedLanguage: SpeechLanguage | undefined = language === 'auto' ? undefined : language
  const settings = indexTtsSettingsSchema.parse(controls ?? {})

  return (tokens, meta, signal) => {
    const entries: ({ text: string, paragraph: boolean } | { special: string })[] = []
    let pending = ''
    const sentences = new Intl.Segmenter(undefined, { granularity: 'sentence' })

    function drain() {
      // Line breaks delimit Markdown blocks after speech-text conversion. Keep them
      // in the annotated source, but attach their longer pause to the preceding sentence.
      for (const line of pending.split(/(\r\n|\r|\n)/u)) {
        if (/^[\r\n]+$/u.test(line)) {
          const previous = entries.at(-1)
          if (previous && 'text' in previous) {
            previous.text += line
            previous.paragraph = true
          }
          continue
        }
        for (const sentence of sentences.segment(line)) {
          if (sentence.segment.trim())
            entries.push({ text: sentence.segment, paragraph: false })
        }
      }
      pending = ''
    }

    return tokens.pipeThrough(new TransformStream<TextToken, TextSegment>({
      transform(token) {
        signal.throwIfAborted()
        if (token.type === 'literal') {
          pending += token.value ?? ''
        }
        else {
          drain()
          if (token.type === 'special')
            entries.push({ special: token.value ?? '' })
        }
      },
      async flush(stream) {
        drain()
        signal.throwIfAborted()
        const texts = entries.flatMap(entry => 'text' in entry ? [entry.text] : [])
        let annotations: LanguageSpan[][] = []
        if (texts.length) {
          if (fixedLanguage && settings.emotionMode !== 'auto') {
            annotations = texts.map(text => [{ text, language: fixedLanguage }])
          }
          else {
            if (!generateText)
              throw new Error('Configure a chat model for automatic speech language annotation')
            // One contextual request avoids classifying a kanji-only fragment in isolation.
            annotations = await createVoiceLanguageAgent(generateText).annotate(texts, signal, settings.emotionMode === 'auto')
          }
        }
        signal.throwIfAborted()
        let sentenceIndex = 0
        let sequence = 0
        for (const entry of entries) {
          if ('special' in entry) {
            stream.enqueue({ ...meta, segmentId: `${meta.streamId}:language:${sequence++}`, text: '', special: entry.special, reason: 'special', createdAt: Date.now() })
            continue
          }
          const spans = annotations[sentenceIndex++]
          for (const [spanIndex, span] of spans.entries()) {
            const isSentenceEnd = spanIndex === spans.length - 1 && sentenceIndex < texts.length
            const pauseAfterMs = isSentenceEnd ? (entry.paragraph ? settings.paragraphPauseMs : settings.sentencePauseMs) : 0
            stream.enqueue({
              ...meta,
              segmentId: `${meta.streamId}:language:${sequence++}`,
              text: span.text,
              language: fixedLanguage ?? span.language,
              style: {
                emotion: settings.emotionMode === 'manual' ? settings.emotion : span.emotion,
                intensity: settings.emotionMode === 'auto' ? (span.intensity ?? 0) * settings.emotionIntensity : settings.emotionIntensity,
                pauseAfterMs,
              },
              special: null,
              reason: 'hard',
              createdAt: Date.now(),
            })
          }
        }
      },
    }))
  }
}
