<script setup lang="ts">
import { errorMessageFrom } from '@moeru/std'
import { cosyVoice3ConfigSchema } from '@proj-airi/provider-inference'
import { FieldInput, FieldInputFile, FieldSelect } from '@proj-airi/ui'
import { computed, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { useProviderConfigStore } from '../../../stores/providers/config'
import { useProviderStore } from '../../../stores/providers/provider'

const { t } = useI18n()
const configs = useProviderConfigStore()
const providers = useProviderStore()
const error = shallowRef('')
const uploading = shallowRef(false)
const emptyConfig = Object.freeze({})
const settings = computed(() => cosyVoice3ConfigSchema.parse(configs.getProviderConfig('cosyvoice3') ?? emptyConfig))
const modes = computed(() => ['zero-shot', 'cross-lingual', 'instruct'].map(value => ({
  value,
  label: t(`settings.pages.providers.provider.cosyvoice3.modes.${value}`),
})))

async function save(patch: Record<string, unknown>) {
  error.value = ''
  await providers.initializeProvider('cosyvoice3')
  await configs.patchProviderConfig('cosyvoice3', patch)
  await providers.validateProvider('cosyvoice3')
}

async function saveField(key: 'mode' | 'referenceText' | 'instruction', value: unknown) {
  if (value === undefined)
    return
  try {
    await save({ [key]: value })
  }
  catch (cause) {
    error.value = errorMessageFrom(cause) ?? t('settings.pages.providers.provider.cosyvoice3.save-error')
  }
}

async function upload(files: File[] | undefined) {
  const file = files?.[0]
  if (!file)
    return
  uploading.value = true
  error.value = ''
  try {
    if (!file.name.toLowerCase().endsWith('.wav') || file.size > 2 * 1024 * 1024)
      throw new Error(t('settings.pages.providers.provider.cosyvoice3.audio-error'))
    const bytes = new Uint8Array(await file.arrayBuffer())
    const signature = new TextDecoder().decode(bytes.subarray(0, 12))
    if (!signature.startsWith('RIFF') || signature.slice(8) !== 'WAVE')
      throw new Error(t('settings.pages.providers.provider.cosyvoice3.audio-error'))
    let binary = ''
    for (const byte of bytes)
      binary += String.fromCharCode(byte)
    // Persist bytes, not a blob URL: previews, chat, and other windows share this recording.
    await save({ referenceAudio: `data:audio/wav;base64,${btoa(binary)}`, referenceName: file.name })
  }
  catch (cause) {
    error.value = errorMessageFrom(cause) ?? t('settings.pages.providers.provider.cosyvoice3.save-error')
  }
  finally {
    uploading.value = false
  }
}
</script>

<template>
  <div :class="['flex flex-col gap-5']">
    <FieldSelect
      :model-value="settings.mode" :options="modes"
      :label="t('settings.pages.providers.provider.cosyvoice3.mode')"
      :description="t('settings.pages.providers.provider.cosyvoice3.mode-description')"
      @update:model-value="saveField('mode', $event)"
    />
    <div :class="['flex flex-col items-start gap-2']">
      <FieldInputFile
        v-if="!uploading" accept=".wav,audio/wav,audio/x-wav" :multiple="false"
        :label="t('settings.pages.providers.provider.cosyvoice3.upload')"
        :placeholder="settings.referenceName"
        @update:model-value="upload"
      />
      <p :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        {{ settings.referenceName || t('settings.pages.providers.provider.cosyvoice3.no-reference') }}
      </p>
      <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        {{ t('settings.pages.providers.provider.cosyvoice3.audio-description') }}
      </p>
    </div>
    <FieldInput
      v-if="settings.mode === 'zero-shot'"
      :model-value="settings.referenceText"
      :label="t('settings.pages.providers.provider.cosyvoice3.reference-text')"
      :description="t('settings.pages.providers.provider.cosyvoice3.reference-text-description')"
      @update:model-value="saveField('referenceText', $event)"
    />
    <FieldInput
      v-if="settings.mode === 'instruct'"
      :model-value="settings.instruction"
      :label="t('settings.pages.providers.provider.cosyvoice3.instruction')"
      :description="t('settings.pages.providers.provider.cosyvoice3.instruction-description')"
      @update:model-value="saveField('instruction', $event)"
    />
    <p v-if="error" role="alert" :class="['text-sm text-red-500']">
      {{ error }}
    </p>
  </div>
</template>
