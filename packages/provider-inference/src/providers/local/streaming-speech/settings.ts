import { z } from 'zod'

/** Model ID exposed by version 1 of the independent speech service. */
export const STREAMING_SPEECH_MODEL = 's2-pro'

/** Persisted connection and playback settings. Model internals stay on the service. */
export const streamingSpeechConfigSchema = z.object({
  baseUrl: z.url().refine(value => /^https?:/u.test(value)).default('http://127.0.0.1:18080/api/v1/'),
  model: z.string().min(1).default(STREAMING_SPEECH_MODEL),
  voice: z.string().min(1).default('default'),
  referenceId: z.union([z.literal(''), z.literal('none'), z.string().regex(/^ref-[a-f0-9]{24}$/u)]).default(''),
  multiSpeakerEnabled: z.boolean().default(false),
  speakerReferences: z.record(z.string().regex(/^(?:\d|1[0-5])$/u), z.union([z.literal('default'), z.literal('none'), z.string().regex(/^ref-[a-f0-9]{24}$/u)])).default({ 0: 'none' }),
  annotationEnabled: z.boolean().default(true),
  annotationBaseUrl: z.url().refine(value => /^https?:/u.test(value)).default('https://text.novelai.net/oa/v1/'),
  annotationModel: z.string().min(1).default('glm-4-6'),
  annotationApiKey: z.string().default(''),
  annotationBatchSize: z.number().int().min(1).max(20).default(3),
  mergeForSynthesis: z.boolean().default(false),
  gap: z.number().min(0).max(2).default(1),
  streamBufferMs: z.number().min(500).max(6000).default(2500),
  maxCacheSeconds: z.number().min(6).max(30).default(12),
  segmentation: z.object({
    mode: z.enum(['sentence', 'length']).default('sentence'),
    threshold: z.number().min(0).max(1).default(0.25),
    min_length: z.number().int().min(1).max(160).default(1),
    max_length: z.number().int().min(12).max(160).default(80),
    prior_type: z.enum(['uniform', 'gaussian', 'lognormal', 'clipped_polynomial']).default('uniform'),
    target_length: z.number().int().min(1).max(160).default(50),
    spread: z.number().positive().max(160).default(15),
    algorithm: z.enum(['viterbi', 'greedy']).default('viterbi'),
  }).superRefine((value, context) => {
    if (value.min_length > value.max_length)
      context.addIssue({ code: 'custom', message: 'min_length cannot exceed max_length.' })
    if (value.mode === 'length' && value.prior_type !== 'uniform' && (value.target_length < value.min_length || value.target_length > value.max_length))
      context.addIssue({ code: 'custom', message: 'target_length must be between min_length and max_length.' })
  }).prefault({}),
}).superRefine((value, context) => {
  if (value.multiSpeakerEnabled && !Object.hasOwn(value.speakerReferences, '0'))
    context.addIssue({ code: 'custom', path: ['speakerReferences'], message: 'Speaker 0 is required as the narrator.' })
})
