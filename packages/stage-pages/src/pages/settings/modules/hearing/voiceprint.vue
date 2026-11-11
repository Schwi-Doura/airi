<script setup lang="ts">
import { speakerModel } from '@proj-airi/stage-shared/speaker-model'
import { useModelAssetFailureMessage, useModelAssetStatus } from '@proj-airi/stage-ui/composables/use-model-asset-status'
import { useVoiceEnrollment } from '@proj-airi/stage-ui/composables/use-voice-enrollment'
import { useVoiceprintTest } from '@proj-airi/stage-ui/composables/use-voiceprint-test'
import { isSherpawModelBundled } from '@proj-airi/stage-ui/libs/providers/providers/sherpaw/model-assets'
import { OWNER_VOICE_THRESHOLD } from '@proj-airi/stage-ui/libs/voice/speaker-recognition'
import { MIN_ENROLLMENT_SPEECH_SECONDS } from '@proj-airi/stage-ui/libs/voice/voice-enrollment'
import { useHearingStore } from '@proj-airi/stage-ui/stores/modules/hearing'
import { useVoiceprintStore } from '@proj-airi/stage-ui/stores/voiceprint'
import { Button, DoubleCheckButton, FieldCheckbox, Progress, SettingsCard } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t, locale } = useI18n()
const voiceprints = useVoiceprintStore()
const { speakerRecognitionEnabled } = storeToRefs(useHearingStore())
// The enrollment belongs to this page. It ends when the user leaves the page or closes the window.
const { state: enrollment, busy, begin, finish, cancel } = useVoiceEnrollment()
const { models } = useModelAssetStatus()
const failureMessage = useModelAssetFailureMessage()
// A bundled model needs no download, so the page does not announce one.
const modelBundled = isSherpawModelBundled(speakerModel.id)
// The model loads only while an enrollment enrolls. A download failure from an earlier enrollment must not explain a microphone error.
const modelRequested = shallowRef(false)
watch(() => enrollment.value.phase, (phase) => {
  if (phase === 'recording')
    modelRequested.value = false
  else if (phase === 'enrolling')
    modelRequested.value = true
})
const modelFailure = computed(() => modelRequested.value ? models.value.find(model => model.id === speakerModel.id)?.error : undefined)

const { state: test, score: testScore, busy: testBusy, begin: beginTest, finish: finishTest, cancel: cancelTest } = useVoiceprintTest()

const sentences = computed(() => [1, 2, 3].map(index => t(`settings.pages.modules.hearing.voiceprint.sentence-${index}`)))
const speechSeconds = computed(() => enrollment.value.phase === 'idle' ? 0 : enrollment.value.speechSeconds)
const testSeconds = computed(() => test.value.phase === 'idle' ? 0 : test.value.speechSeconds)

const testResult = computed(() => {
  const value = test.value
  switch (value.phase) {
    case 'enrolled': {
      const passed = testScore.value !== undefined && testScore.value >= OWNER_VOICE_THRESHOLD
      const key = passed ? 'passed' : 'rejected'
      return { tone: passed ? 'green' : 'orange', text: t(`settings.pages.modules.hearing.voiceprint.test.${key}`, {
        score: testScore.value?.toFixed(3) ?? t('settings.pages.modules.hearing.voiceprint.test.no-score'),
        threshold: OWNER_VOICE_THRESHOLD,
      }) } as const
    }
    case 'failed':
      return { tone: 'orange', text: value.failure === 'too-short'
        ? t('settings.pages.modules.hearing.voiceprint.test.too-short', { min: MIN_ENROLLMENT_SPEECH_SECONDS })
        : t('settings.pages.modules.hearing.voiceprint.test.error', { error: value.error ?? '' }) } as const
    case 'cancelled':
      return { tone: 'neutral', text: t('settings.pages.modules.hearing.voiceprint.test.cancelled') } as const
    default:
      return undefined
  }
})

/** `none`: nothing saved. `enrolled`: a usable voiceprint. `outdated`: another model revision computed it. */
const status = computed(() => {
  const record = voiceprints.record
  if (!record)
    return { state: 'none', text: t('settings.pages.modules.hearing.voiceprint.status.none') }
  if (voiceprints.outdated)
    return { state: 'outdated', text: t('settings.pages.modules.hearing.voiceprint.status.outdated') }
  return {
    state: 'enrolled',
    text: t('settings.pages.modules.hearing.voiceprint.status.enrolled', {
      date: new Date(record.createdAt).toLocaleDateString(locale.value),
      seconds: Math.round(record.seconds),
    }),
  }
})

/** The outcome of the last enrollment on this page. */
const result = computed(() => {
  const value = enrollment.value
  switch (value.phase) {
    case 'enrolled':
      return { tone: 'green', text: t('settings.pages.modules.hearing.voiceprint.result.enrolled') } as const
    case 'cancelled':
      return { tone: 'neutral', text: t('settings.pages.modules.hearing.voiceprint.result.cancelled') } as const
    case 'failed':
      return value.failure === 'too-short'
        ? { tone: 'orange', text: t('settings.pages.modules.hearing.voiceprint.result.too-short', { seconds: value.speechSeconds.toFixed(1), min: MIN_ENROLLMENT_SPEECH_SECONDS }) } as const
        // A failed model download also fails the enrollment with a raw message. The download failure explains it better.
        : { tone: 'orange', text: t('settings.pages.modules.hearing.voiceprint.result.error', { error: modelFailure.value ? failureMessage(modelFailure.value) : value.error ?? '' }) } as const
    default:
      return undefined
  }
})

const resultClasses = {
  green: ['text-emerald-600 dark:text-emerald-400'],
  orange: ['text-amber-600 dark:text-amber-400'],
  neutral: ['text-neutral-500 dark:text-neutral-400'],
} as const
</script>

<template>
  <div :class="['flex flex-col gap-6']">
    <SettingsCard>
      <div :class="['flex flex-col gap-2 text-sm', 'text-neutral-500 dark:text-neutral-400']">
        <p>{{ t('settings.pages.modules.hearing.voiceprint.intro') }}</p>
        <p>{{ t('settings.pages.modules.hearing.voiceprint.privacy') }}</p>
      </div>
    </SettingsCard>

    <SettingsCard>
      <p
        data-testid="voiceprint-status"
        :data-state="status.state"
        :class="['font-medium', 'text-neutral-700 dark:text-neutral-200']"
      >
        {{ status.text }}
      </p>

      <div :class="['flex flex-col gap-2']">
        <p :class="['text-sm', 'text-neutral-500 dark:text-neutral-400']">
          {{ t('settings.pages.modules.hearing.voiceprint.instructions') }}
        </p>
        <ol :class="['flex flex-col gap-2 pl-5 list-decimal', 'text-neutral-800 dark:text-neutral-100']">
          <li v-for="sentence in sentences" :key="sentence">
            {{ sentence }}
          </li>
        </ol>
      </div>

      <div v-if="busy" data-testid="voiceprint-progress" :class="['flex flex-col gap-2']">
        <Progress :progress="Math.min(100, speechSeconds / MIN_ENROLLMENT_SPEECH_SECONDS * 100)" />
        <p :class="['text-sm', 'text-neutral-500 dark:text-neutral-400']">
          {{ enrollment.phase === 'enrolling'
            ? t('settings.pages.modules.hearing.voiceprint.enrolling')
            : t('settings.pages.modules.hearing.voiceprint.progress', { seconds: speechSeconds.toFixed(1), min: MIN_ENROLLMENT_SPEECH_SECONDS }) }}
        </p>
      </div>

      <p
        v-else-if="result"
        data-testid="voiceprint-result"
        :data-phase="enrollment.phase"
        :class="['text-sm', resultClasses[result.tone]]"
      >
        {{ result.text }}
      </p>

      <div :class="['flex flex-wrap items-center gap-2']">
        <template v-if="busy">
          <Button
            data-testid="voiceprint-finish"
            variant="primary"
            :label="t('settings.pages.modules.hearing.voiceprint.finish')"
            :disabled="enrollment.phase !== 'recording' || speechSeconds < MIN_ENROLLMENT_SPEECH_SECONDS"
            @click="finish()"
          />
          <Button
            data-testid="voiceprint-cancel"
            :label="t('settings.pages.modules.hearing.voiceprint.cancel')"
            @click="cancel()"
          />
        </template>
        <template v-else>
          <Button
            data-testid="voiceprint-start"
            variant="primary"
            icon="i-solar:microphone-3-bold-duotone"
            :label="voiceprints.record ? t('settings.pages.modules.hearing.voiceprint.again') : t('settings.pages.modules.hearing.voiceprint.start')"
            :disabled="testBusy"
            @click="begin()"
          />
          <DoubleCheckButton v-if="voiceprints.record" data-testid="voiceprint-delete" @confirm="voiceprints.remove()">
            {{ t('settings.pages.modules.hearing.voiceprint.delete') }}
            <template #confirm>
              {{ t('settings.pages.data.confirmations.yes') }}
            </template>
            <template #cancel>
              {{ t('settings.pages.card.cancel') }}
            </template>
          </DoubleCheckButton>
        </template>
      </div>

      <p v-if="!voiceprints.record && !modelBundled" :class="['text-xs', 'text-neutral-400 dark:text-neutral-500']">
        {{ t('settings.pages.modules.hearing.voiceprint.download') }}
      </p>
    </SettingsCard>

    <SettingsCard>
      <p :class="['font-medium', 'text-neutral-700 dark:text-neutral-200']">
        {{ t('settings.pages.modules.hearing.voiceprint.test.title') }}
      </p>
      <p :class="['text-sm', 'text-neutral-500 dark:text-neutral-400']">
        {{ t('settings.pages.modules.hearing.voiceprint.test.description', { min: MIN_ENROLLMENT_SPEECH_SECONDS, threshold: OWNER_VOICE_THRESHOLD }) }}
      </p>
      <div v-if="testBusy" :class="['flex flex-col gap-2']">
        <Progress :progress="Math.min(100, testSeconds / MIN_ENROLLMENT_SPEECH_SECONDS * 100)" />
        <p role="status" :class="['text-sm', 'text-neutral-500 dark:text-neutral-400']">
          {{ test.phase === 'enrolling'
            ? t('settings.pages.modules.hearing.voiceprint.test.comparing')
            : t('settings.pages.modules.hearing.voiceprint.test.progress', { seconds: testSeconds.toFixed(1), min: MIN_ENROLLMENT_SPEECH_SECONDS }) }}
        </p>
      </div>
      <p
        v-if="testResult"
        role="status"
        data-testid="voiceprint-test-result"
        :class="['text-sm', resultClasses[testResult.tone]]"
      >
        {{ testResult.text }}
      </p>
      <div :class="['flex flex-wrap items-center gap-2']">
        <template v-if="testBusy">
          <Button
            data-testid="voiceprint-test-finish"
            variant="primary"
            :label="t('settings.pages.modules.hearing.voiceprint.test.finish')"
            :disabled="test.phase !== 'recording' || testSeconds < MIN_ENROLLMENT_SPEECH_SECONDS"
            @click="finishTest()"
          />
          <Button :label="t('settings.pages.modules.hearing.voiceprint.cancel')" @click="cancelTest()" />
        </template>
        <Button
          v-else
          data-testid="voiceprint-test-start"
          icon="i-solar:microphone-3-bold-duotone"
          :label="t('settings.pages.modules.hearing.voiceprint.test.start')"
          :disabled="!voiceprints.voiceprint || busy"
          @click="beginTest()"
        />
      </div>
    </SettingsCard>

    <SettingsCard>
      <!-- The setting keeps its value without a usable voiceprint, but the voice host compares nothing then. -->
      <FieldCheckbox
        v-model="speakerRecognitionEnabled"
        data-testid="speaker-recognition"
        :disabled="!voiceprints.voiceprint"
        :label="t('settings.pages.modules.hearing.voiceprint.speaker-recognition.label')"
        :description="t('settings.pages.modules.hearing.voiceprint.speaker-recognition.description')"
      />
      <p v-if="!voiceprints.voiceprint" :class="['text-xs', 'text-neutral-400 dark:text-neutral-500']">
        {{ t('settings.pages.modules.hearing.voiceprint.speaker-recognition.needs-voiceprint') }}
      </p>
    </SettingsCard>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.hearing.voiceprint.title
  subtitleKey: settings.pages.modules.hearing.title
  icon: i-solar:user-speak-rounded-bold-duotone
  stageTransition:
    name: slide
</route>
