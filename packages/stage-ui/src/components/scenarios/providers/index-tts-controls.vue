<script setup lang="ts">
import type { IndexTtsSettings } from '@proj-airi/provider-inference'

import { errorMessageFrom } from '@moeru/std'
import { indexTtsEmotions, indexTtsSettingsSchema } from '@proj-airi/provider-inference'
import { FieldRange, FieldSelect } from '@proj-airi/ui'
import { computed, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { useProviderConfigStore } from '../../../stores/providers/config'
import { useProviderStore } from '../../../stores/providers/provider'

const { t } = useI18n()
const configs = useProviderConfigStore()
const providers = useProviderStore()
const error = shallowRef('')
const settings = computed(() => indexTtsSettingsSchema.parse(configs.getProviderConfig('index-tts-vllm') ?? {}))
const modes = computed(() => ['original', 'manual', 'auto'].map(value => ({
  value,
  label: t(`settings.pages.providers.provider.index-tts-vllm.controls.modes.${value}`),
})))
const emotions = computed(() => indexTtsEmotions.map(value => ({
  value,
  label: t(`settings.pages.providers.provider.index-tts-vllm.controls.emotions.${value}`),
})))

async function save(key: keyof IndexTtsSettings, value: unknown) {
  if (value === undefined)
    return
  try {
    error.value = ''
    const validated = indexTtsSettingsSchema.parse({ ...settings.value, [key]: value })
    await providers.initializeProvider('index-tts-vllm')
    await configs.patchProviderConfig('index-tts-vllm', { [key]: validated[key] })
  }
  catch (cause) {
    error.value = errorMessageFrom(cause) ?? t('settings.pages.providers.provider.index-tts-vllm.controls.save-error')
  }
}
</script>

<template>
  <div :class="['flex flex-col gap-5']">
    <FieldRange
      :model-value="settings.speed" :min="0.5" :max="2" :step="0.05"
      :label="t('settings.pages.providers.provider.index-tts-vllm.controls.speed')"
      :description="t('settings.pages.providers.provider.index-tts-vllm.controls.speed-description')"
      :format-value="value => `${value.toFixed(2)}×`"
      @update:model-value="save('speed', $event)"
    />
    <FieldSelect
      :model-value="settings.emotionMode" :options="modes"
      :label="t('settings.pages.providers.provider.index-tts-vllm.controls.mode')"
      :description="t('settings.pages.providers.provider.index-tts-vllm.controls.mode-description')"
      @update:model-value="save('emotionMode', $event)"
    />
    <FieldSelect
      v-if="settings.emotionMode === 'manual'"
      :model-value="settings.emotion" :options="emotions"
      :label="t('settings.pages.providers.provider.index-tts-vllm.controls.emotion')"
      @update:model-value="save('emotion', $event)"
    />
    <FieldRange
      v-if="settings.emotionMode !== 'original'"
      :model-value="settings.emotionIntensity" :min="0" :max="1" :step="0.05"
      :label="t('settings.pages.providers.provider.index-tts-vllm.controls.intensity')"
      :description="t('settings.pages.providers.provider.index-tts-vllm.controls.intensity-description')"
      :format-value="value => `${Math.round(value * 100)}%`"
      @update:model-value="save('emotionIntensity', $event)"
    />
    <FieldRange
      v-for="key in (['sentencePauseMs', 'paragraphPauseMs'] as const)" :key="key"
      :model-value="settings[key]" :min="0" :max="3000" :step="50"
      :label="t(`settings.pages.providers.provider.index-tts-vllm.controls.${key}`)"
      :description="t('settings.pages.providers.provider.index-tts-vllm.controls.pause-description')"
      :format-value="value => `${value} ms`"
      @update:model-value="save(key, $event)"
    />
    <p v-if="error" role="alert" :class="['text-sm text-red-500']">
      {{ error }}
    </p>
  </div>
</template>
