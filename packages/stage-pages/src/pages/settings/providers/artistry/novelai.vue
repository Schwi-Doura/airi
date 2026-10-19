<script setup lang="ts">
import { useArtistryStore } from '@proj-airi/stage-ui/stores/modules/artistry'
import { FieldInput, FieldSelect, FieldTextArea } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

const { novelaiApiKey, novelaiBaseUrl, novelaiModel, novelaiPromptPrefix, novelaiNegativePrompt } = storeToRefs(useArtistryStore())
const { t } = useI18n()

/** Text-to-image model IDs from NovelAI's frontend model catalogue; inpainting variants require a different workflow. */
const models = [
  { label: 'NovelAI Diffusion V5 Full', value: 'nai-diffusion-5-full' },
  { label: 'NovelAI Diffusion V5 Curated', value: 'nai-diffusion-5-curated' },
  { label: 'NovelAI Diffusion V4.5 Full', value: 'nai-diffusion-4-5-full' },
  { label: 'NovelAI Diffusion V4.5 Curated', value: 'nai-diffusion-4-5-curated' },
  { label: 'NovelAI Diffusion V4 Full', value: 'nai-diffusion-4-full' },
  { label: 'NovelAI Diffusion V4 Curated', value: 'nai-diffusion-4-curated-preview' },
  { label: 'NovelAI Diffusion Anime V3', value: 'nai-diffusion-3' },
  { label: 'NovelAI Diffusion Furry V3', value: 'nai-diffusion-furry-3' },
]

const useCustomModel = shallowRef(false)
const modelOptions = computed(() => [
  ...models,
  { label: t('settings.pages.providers.provider.novelai.custom-model'), value: 'custom' },
])
const selectedModel = computed({
  get: () => useCustomModel.value || !models.some(model => model.value === novelaiModel.value)
    ? 'custom'
    : novelaiModel.value,
  set: (value: string) => {
    useCustomModel.value = value === 'custom'
    if (!useCustomModel.value)
      novelaiModel.value = value
  },
})
</script>

<template>
  <div :class="['flex flex-col gap-4']">
    <h2 :class="['text-xl font-semibold']">
      NovelAI Diffusion
    </h2>
    <p>{{ t('settings.pages.providers.provider.novelai.image-description') }}</p>
    <FieldInput
      v-model="novelaiApiKey"
      type="password"
      :label="t('settings.pages.providers.provider.novelai.token')"
      placeholder="Persistent API Token"
    />
    <FieldInput
      v-model="novelaiBaseUrl"
      :label="t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.label')"
      placeholder="https://image.novelai.net/"
    />
    <FieldSelect
      v-model="selectedModel"
      :label="t('settings.pages.providers.provider.novelai-speech.model')"
      :description="t('settings.pages.providers.provider.novelai.image-model-description')"
      :options="modelOptions"
    />
    <FieldInput
      v-if="selectedModel === 'custom'"
      v-model="novelaiModel"
      :label="t('settings.pages.providers.provider.novelai.custom-model-id')"
      placeholder="nai-diffusion-3"
    />
    <FieldTextArea
      v-model="novelaiPromptPrefix"
      :label="t('settings.pages.providers.provider.novelai.positive-prompt')"
      :description="t('settings.pages.providers.provider.novelai.positive-prompt-description')"
      :required="false"
      :rows="3"
    />
    <FieldTextArea
      v-model="novelaiNegativePrompt"
      :label="t('settings.pages.providers.provider.novelai.negative-prompt')"
      :description="t('settings.pages.providers.provider.novelai.negative-prompt-description')"
      :required="false"
      :rows="3"
    />
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.providers.provider.novelai.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
</route>
