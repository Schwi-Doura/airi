<script setup lang="ts">
import { errorMessageFrom } from '@moeru/std'
import { StreamingSpeechClient, streamingSpeechConfigSchema } from '@proj-airi/provider-inference'
import { Button, FieldCheckbox, FieldInput, FieldRange, FieldSelect } from '@proj-airi/ui'
import { computed, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import StreamingSpeechReference from './streaming-speech-reference.vue'
import StreamingSpeechSegmentation from './streaming-speech-segmentation.vue'
import StreamingSpeechSpeakers from './streaming-speech-speakers.vue'

import { useProviderConfigStore } from '../../../stores/providers/config'
import { useProviderStore } from '../../../stores/providers/provider'

const { t } = useI18n()
const configs = useProviderConfigStore()
const providers = useProviderStore()
const emptyConfig = Object.freeze({})
const settings = computed(() => streamingSpeechConfigSchema.parse(configs.getProviderConfig('streaming-speech') ?? emptyConfig))
const error = shallowRef('')
const annotationBaseUrl = shallowRef(settings.value.annotationBaseUrl)
const annotationModel = shallowRef(settings.value.annotationModel)
const annotationApiKey = shallowRef(settings.value.annotationApiKey)
watch([() => settings.value.annotationBaseUrl, () => settings.value.annotationModel, () => settings.value.annotationApiKey], ([url, model, key]) => {
  annotationBaseUrl.value = url
  annotationModel.value = model
  annotationApiKey.value = key
})
const textModels = shallowRef<{ value: string, label: string }[]>([])
const checking = shallowRef(false)
const connectionStatus = shallowRef('')

async function refreshModels() {
  checking.value = true
  error.value = ''
  connectionStatus.value = ''
  try {
    const client = new StreamingSpeechClient({ ...settings.value, annotationBaseUrl: annotationBaseUrl.value, annotationModel: annotationModel.value, annotationApiKey: annotationApiKey.value })
    textModels.value = (await client.textModels()).map(model => ({ value: model.id, label: model.name }))
    connectionStatus.value = t('settings.pages.providers.provider.streaming-speech.annotation-connected', { count: textModels.value.length })
  }
  catch (cause) {
    error.value = errorMessageFrom(cause) ?? t('settings.pages.providers.provider.streaming-speech.save-error')
  }
  finally {
    checking.value = false
  }
}
watch([annotationBaseUrl, annotationApiKey], () => {
  textModels.value = []
  connectionStatus.value = ''
})

async function save(field: 'gap' | 'streamBufferMs' | 'maxCacheSeconds' | 'annotationEnabled' | 'annotationBatchSize' | 'mergeForSynthesis', value: string | number | boolean | undefined) {
  if (value === undefined)
    return
  error.value = ''
  try {
    await providers.initializeProvider('streaming-speech')
    await configs.patchProviderConfig('streaming-speech', { [field]: value })
    await providers.validateProvider('streaming-speech')
  }
  catch (cause) {
    error.value = errorMessageFrom(cause) ?? t('settings.pages.providers.provider.streaming-speech.save-error')
  }
}

async function saveAnnotation() {
  error.value = ''
  try {
    const value = streamingSpeechConfigSchema.parse({ ...settings.value, annotationBaseUrl: annotationBaseUrl.value, annotationModel: annotationModel.value, annotationApiKey: annotationApiKey.value })
    await providers.initializeProvider('streaming-speech')
    await configs.patchProviderConfig('streaming-speech', { annotationBaseUrl: value.annotationBaseUrl, annotationModel: value.annotationModel, annotationApiKey: value.annotationApiKey })
    await providers.validateProvider('streaming-speech')
  }
  catch {
    error.value = t('settings.pages.providers.provider.streaming-speech.save-error')
  }
}
</script>

<template>
  <div :class="['flex flex-col gap-4']">
    <StreamingSpeechReference />
    <StreamingSpeechSpeakers />
    <FieldCheckbox
      :model-value="settings.annotationEnabled"
      :label="t('settings.pages.providers.provider.streaming-speech.annotation-enabled')"
      :description="t('settings.pages.providers.provider.streaming-speech.annotation-enabled-description')"
      @update:model-value="save('annotationEnabled', $event)"
    />
    <template v-if="settings.annotationEnabled">
      <FieldInput v-model="annotationBaseUrl" :label="t('settings.pages.providers.provider.streaming-speech.annotation-url')" />
      <FieldInput v-model="annotationModel" :label="t('settings.pages.providers.provider.streaming-speech.annotation-model')" />
      <FieldInput
        v-model="annotationApiKey" type="password" autocomplete="off"
        :label="t('settings.pages.providers.provider.streaming-speech.annotation-key')"
        :description="t('settings.pages.providers.provider.streaming-speech.annotation-key-description')"
      />
      <FieldSelect v-if="textModels.length" v-model="annotationModel" :options="textModels" :label="t('settings.pages.providers.provider.streaming-speech.annotation-available-models')" />
      <Button :disabled="checking" @click="refreshModels">
        {{ t('settings.pages.providers.provider.streaming-speech.annotation-check') }}
      </Button>
      <p v-if="connectionStatus" role="status" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        {{ connectionStatus }}
      </p>
      <Button @click="saveAnnotation">
        {{ t('settings.pages.providers.provider.streaming-speech.annotation-save') }}
      </Button>
    </template>
    <FieldCheckbox
      :model-value="settings.mergeForSynthesis"
      :label="t('settings.pages.providers.provider.streaming-speech.merge-synthesis')"
      :description="t('settings.pages.providers.provider.streaming-speech.merge-description')"
      @update:model-value="save('mergeForSynthesis', $event)"
    />
    <FieldRange
      :model-value="settings.annotationBatchSize" :disabled="!settings.annotationEnabled && !settings.mergeForSynthesis" :min="1" :max="20" :step="1"
      :label="t('settings.pages.providers.provider.streaming-speech.annotation-batch')"
      :description="t('settings.pages.providers.provider.streaming-speech.annotation-batch-description')"
      @update:model-value="save('annotationBatchSize', $event)"
    />
    <FieldRange
      :model-value="settings.gap" :min="0" :max="2" :step="0.1"
      :label="t('settings.pages.providers.provider.streaming-speech.gap')"
      :description="t(settings.mergeForSynthesis ? 'settings.pages.providers.provider.streaming-speech.gap-batch-description' : 'settings.pages.providers.provider.streaming-speech.gap-description')"
      :format-value="value => `${value.toFixed(1)} s`"
      @update:model-value="save('gap', $event)"
    />
    <FieldRange
      :model-value="settings.streamBufferMs" :min="500" :max="6000" :step="500"
      :label="t('settings.pages.providers.provider.streaming-speech.initial-buffer')"
      :format-value="value => `${value} ms`"
      @update:model-value="save('streamBufferMs', $event)"
    />
    <FieldRange
      :model-value="settings.maxCacheSeconds" :min="6" :max="30" :step="1"
      :label="t('settings.pages.providers.provider.streaming-speech.max-cache')"
      :format-value="value => `${value} s`"
      @update:model-value="save('maxCacheSeconds', $event)"
    />
    <StreamingSpeechSegmentation />
    <p v-if="error" role="alert" :class="['text-sm text-red-500']">
      {{ error }}
    </p>
  </div>
</template>
