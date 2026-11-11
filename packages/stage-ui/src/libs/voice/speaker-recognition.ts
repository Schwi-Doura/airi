import type { SpeakerEvidence } from '@proj-airi/core-agent'

/** Initial cosine cutoff for the pinned CAM++ model. Real microphone recordings still need calibration. */
export const OWNER_VOICE_THRESHOLD = 0.5

/** Both live recognition and settings tests compare one-second windows every quarter second. */
export const SPEAKER_COMPARISON = { windowMs: 1000, hopMs: 250 } as const

/** Shared admission rule for starting transcription and accepting its final input. Missing evidence never passes. */
export function matchesOwnerVoice(evidence: Pick<SpeakerEvidence, 'candidates' | 'voicedMs'> | undefined): boolean {
  const owner = evidence?.candidates.find(candidate => candidate.speakerId === 'owner')
  return !!evidence && evidence.voicedMs > 0 && !!owner && Number.isFinite(owner.score) && owner.score >= OWNER_VOICE_THRESHOLD
}

/** Ignores windows without a voice embedding. No usable window gives no score and cannot pass recognition. */
export function meanSpeakerScore(scores: Iterable<number>): number | undefined {
  let sum = 0
  let count = 0
  for (const score of scores) {
    if (!Number.isFinite(score))
      continue
    sum += score
    count++
  }
  return count ? sum / count : undefined
}
