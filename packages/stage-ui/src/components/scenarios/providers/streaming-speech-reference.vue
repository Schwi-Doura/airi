<script setup lang="ts">
import { errorMessageFrom } from '@moeru/std'
import { StreamingSpeechClient, streamingSpeechConfigSchema } from '@proj-airi/provider-inference'
import { Button, FieldInput, FieldInputFile, FieldSelect } from '@proj-airi/ui'
import { computed, onScopeDispose, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useProviderConfigStore } from '../../../stores/providers/config'
import { useProviderStore } from '../../../stores/providers/provider'

const { t } = useI18n()
const configs = useProviderConfigStore()
const providers = useProviderStore()
const emptyConfig = Object.freeze({})
const settings = computed(() => streamingSpeechConfigSchema.parse(configs.getProviderConfig('streaming-speech') ?? emptyConfig))
const files = shallowRef<File[]>()
const transcript = shallowRef<string | undefined>('')
const name = shallowRef('')
const savedReferenceId = shallowRef('')
const references = shallowRef<Awaited<ReturnType<StreamingSpeechClient['references']>>>([])
const referenceModes = computed(() => [
  { value: 'default', label: t('settings.pages.providers.provider.streaming-speech.reference-service') },
  { value: 'none', label: t('settings.pages.providers.provider.streaming-speech.reference-none') },
  ...references.value.map(reference => ({ value: reference.id, label: reference.name })),
])
const loading = shallowRef(false)
const saving = shallowRef(false)
const error = shallowRef('')
let loadRequest: AbortController | undefined
let saveRequest: AbortController | undefined
onScopeDispose(() => {
  loadRequest?.abort()
  saveRequest?.abort()
})

async function load() {
  loadRequest?.abort()
  const request = new AbortController()
  loadRequest = request
  loading.value = true
  error.value = ''
  files.value = undefined
  try {
    const client = new StreamingSpeechClient(settings.value)
    const [reference, catalog] = await Promise.all([client.reference(settings.value.referenceId || 'default', request.signal), client.references(request.signal)])
    if (request.signal.aborted)
      return
    references.value = catalog
    savedReferenceId.value = reference.id?.startsWith('ref-') ? reference.id : ''
    transcript.value = reference.text
    name.value = reference.name
  }
  catch (cause) {
    if (!request.signal.aborted)
      error.value = errorMessageFrom(cause) ?? t('settings.pages.providers.provider.streaming-speech.reference-error')
  }
  finally {
    if (loadRequest === request)
      loading.value = false
  }
}
watch([() => settings.value.baseUrl, () => settings.value.referenceId], load, { immediate: true })

function selectAudio(value: File[] | undefined) {
  files.value = value
  if (value?.[0]) {
    transcript.value = ''
    name.value = value[0].name
  }
}

async function save() {
  saving.value = true
  error.value = ''
  const snapshot = settings.value
  const request = new AbortController()
  saveRequest = request
  try {
    const text = transcript.value ?? ''
    if (!text.trim())
      throw new Error(t('settings.pages.providers.provider.streaming-speech.reference-text-required'))
    const file = files.value?.[0]
    let audio: string | undefined
    if (file) {
      if (!/\.(?:wav|mp3)$/iu.test(file.name) || file.size > 20 * 1024 * 1024)
        throw new Error(t('settings.pages.providers.provider.streaming-speech.reference-audio-error'))
      const bytes = new Uint8Array(await file.arrayBuffer())
      let binary = ''
      for (let offset = 0; offset < bytes.length; offset += 32768)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
      audio = btoa(binary)
    }
    const reference = await new StreamingSpeechClient(snapshot).saveReference({
      text,
      name: name.value.trim() || undefined,
      ...(file ? { audio } : { sourceId: savedReferenceId.value || 'default' }),
    }, request.signal)
    request.signal.throwIfAborted()
    if (settings.value.baseUrl !== snapshot.baseUrl)
      throw new Error(t('settings.pages.providers.provider.streaming-speech.reference-error'))
    await providers.initializeProvider('streaming-speech')
    await configs.patchProviderConfig('streaming-speech', { referenceId: reference.id })
  }
  catch (cause) {
    if (!request.signal.aborted)
      error.value = errorMessageFrom(cause) ?? t('settings.pages.providers.provider.streaming-speech.reference-error')
  }
  finally {
    saving.value = false
  }
}

async function selectReference(value: string | undefined) {
  if (value === undefined)
    return
  error.value = ''
  try {
    await providers.initializeProvider('streaming-speech')
    await configs.patchProviderConfig('streaming-speech', { referenceId: value === 'default' ? '' : value })
  }
  catch (cause) {
    error.value = errorMessageFrom(cause) ?? t('settings.pages.providers.provider.streaming-speech.reference-error')
  }
}

async function reset() {
  error.value = ''
  try {
    await configs.patchProviderConfig('streaming-speech', { referenceId: 'none' })
  }
  catch (cause) {
    error.value = errorMessageFrom(cause) ?? t('settings.pages.providers.provider.streaming-speech.reference-error')
  }
}
</script>

<template>
  <div :class="['flex flex-col gap-4']">
    <FieldSelect
      :model-value="settings.referenceId || 'default'" :options="referenceModes" :disabled="loading || saving"
      :label="t('settings.pages.providers.provider.streaming-speech.reference-mode')"
      :description="t('settings.pages.providers.provider.streaming-speech.reference-mode-description')"
      @update:model-value="selectReference"
    />
    <Button :disabled="loading || saving" @click="load">
      {{ t('settings.pages.providers.provider.streaming-speech.reference-refresh') }}
    </Button>
    <FieldInput
      v-model="name" :disabled="loading || saving"
      :label="t('settings.pages.providers.provider.streaming-speech.reference-name')"
    />
    <FieldInputFile
      v-if="!loading && !saving" accept=".wav,.mp3,audio/wav,audio/mpeg" :multiple="false"
      :label="t('settings.pages.providers.provider.streaming-speech.reference-audio')"
      :description="t('settings.pages.providers.provider.streaming-speech.reference-description')"
      :placeholder="files?.[0]?.name || name"
      @update:model-value="selectAudio"
    />
    <p :class="['text-sm text-neutral-500 dark:text-neutral-400']">
      {{ files?.[0]?.name || name }}
    </p>
    <FieldInput
      v-model="transcript" :single-line="false" :disabled="loading || saving"
      :label="t('settings.pages.providers.provider.streaming-speech.reference-text')"
      :description="t('settings.pages.providers.provider.streaming-speech.reference-text-description')"
    />
    <div :class="['flex flex-wrap gap-2']">
      <Button :disabled="loading || saving" @click="save">
        {{ t('settings.pages.providers.provider.streaming-speech.reference-save') }}
      </Button>
      <Button :disabled="saving || settings.referenceId === 'none'" @click="reset">
        {{ t('settings.pages.providers.provider.streaming-speech.reference-reset') }}
      </Button>
    </div>
    <p v-if="error" role="alert" :class="['text-sm text-red-500']">
      {{ error }}
    </p>
  </div>
</template>
