<script setup lang="ts">
import { streamingSpeechConfigSchema } from '@proj-airi/provider-inference'
import { Button, FieldRange, FieldSelect } from '@proj-airi/ui'
import { computed, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useProviderConfigStore } from '../../../stores/providers/config'
import { useProviderStore } from '../../../stores/providers/provider'

const { t } = useI18n()
const configs = useProviderConfigStore()
const providers = useProviderStore()
const emptyConfig = Object.freeze({})
const settings = computed(() => streamingSpeechConfigSchema.parse(configs.getProviderConfig('streaming-speech') ?? emptyConfig))
const draft = ref({ ...settings.value.segmentation })
const error = shallowRef('')
const saving = shallowRef(false)
watch(() => JSON.stringify(settings.value.segmentation), () => {
  draft.value = { ...settings.value.segmentation }
})
const modes = computed(() => [
  { value: 'sentence', label: t('settings.pages.providers.provider.streaming-speech.segment-sentence') },
  { value: 'length', label: t('settings.pages.providers.provider.streaming-speech.segment-length') },
])
const priors = ['uniform', 'gaussian', 'lognormal', 'clipped_polynomial'].map(value => ({ value, label: value }))

async function save() {
  error.value = ''
  saving.value = true
  try {
    const value = streamingSpeechConfigSchema.parse({ ...settings.value, segmentation: { ...draft.value, min_length: draft.value.mode === 'sentence' ? 1 : draft.value.min_length, threshold: 0.25, algorithm: 'viterbi' } })
    await providers.initializeProvider('streaming-speech')
    await configs.patchProviderConfig('streaming-speech', { segmentation: value.segmentation })
  }
  catch {
    error.value = t('settings.pages.providers.provider.streaming-speech.segment-error')
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <fieldset :class="['flex flex-col gap-4', 'border border-neutral-200 rounded-lg p-4 dark:border-neutral-700']">
    <legend>{{ t('settings.pages.providers.provider.streaming-speech.segmentation') }}</legend>
    <FieldSelect v-model="draft.mode" :options="modes" :label="t('settings.pages.providers.provider.streaming-speech.segment-mode')" :description="t('settings.pages.providers.provider.streaming-speech.segment-description')" />
    <FieldRange v-model="draft.max_length" :min="12" :max="160" :step="1" :label="t('settings.pages.providers.provider.streaming-speech.segment-max')" />
    <template v-if="draft.mode === 'length'">
      <FieldRange v-model="draft.min_length" :min="1" :max="160" :step="1" :label="t('settings.pages.providers.provider.streaming-speech.segment-min')" />
      <FieldSelect v-model="draft.prior_type" :options="priors" :label="t('settings.pages.providers.provider.streaming-speech.segment-prior')" />
      <template v-if="draft.prior_type !== 'uniform'">
        <FieldRange v-model="draft.target_length" :min="1" :max="160" :step="1" :label="t('settings.pages.providers.provider.streaming-speech.segment-target')" />
        <FieldRange v-model="draft.spread" :min="1" :max="160" :step="1" :label="t('settings.pages.providers.provider.streaming-speech.segment-spread')" />
      </template>
    </template>
    <Button :disabled="saving" @click="save">
      {{ t('settings.pages.providers.provider.streaming-speech.segment-save') }}
    </Button>
    <p v-if="error" role="alert">
      {{ error }}
    </p>
  </fieldset>
</template>
