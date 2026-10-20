import { z } from 'zod'

/** Native IndexTTS vector order. Neutral leaves the reference voice's expression unchanged. */
export const indexTtsEmotions = ['happy', 'angry', 'sad', 'afraid', 'disgusted', 'melancholic', 'surprised', 'calm'] as const

/** Named expression selected for one sentence; neutral preserves the reference expression. */
export type IndexTtsEmotion = typeof indexTtsEmotions[number] | 'neutral'

/** Persisted provider settings shared by configuration, previews, and chat synthesis. */
export const indexTtsSettingsSchema = z.object({
  baseUrl: z.string().default('http://localhost:11996/tts/'),
  model: z.string().default('IndexTTS-2.5'),
  language: z.enum(['auto', 'ZH', 'EN', 'JA', 'ES', 'AR']).default('auto'),
  /** Speaking-rate multiplier. Native duration is its reciprocal. @default 1 */
  speed: z.number().min(0.5).max(2).default(1),
  /** Auto annotates emotion with the configured chat model. @default 'original' */
  emotionMode: z.enum(['original', 'manual', 'auto']).default('original'),
  /** Manual emotion preset. @default 'happy' */
  emotion: z.enum([...indexTtsEmotions, 'neutral']).default('happy'),
  /** Manual strength, or the upper bound for automatic strength. @default 0.4 */
  emotionIntensity: z.number().min(0).max(1).default(0.4),
  /** Extra silence between complete sentences, in milliseconds. @default 250 */
  sentencePauseMs: z.number().int().min(0).max(3000).default(250),
  /** Extra silence at a line or paragraph break, in milliseconds. @default 500 */
  paragraphPauseMs: z.number().int().min(0).max(3000).default(500),
})

/** Validated settings after provider defaults have been applied. */
export type IndexTtsSettings = z.output<typeof indexTtsSettingsSchema>

/** Per-span overrides. Pause comes from sentence boundaries, never from language changes. */
export type IndexTtsSpeechOptions = Partial<IndexTtsSettings> & {
  /** Appended silence after this audio, in milliseconds. @default 0 */
  pauseAfterMs?: number
}
