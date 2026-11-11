<script setup lang="ts">
import { errorMessageFrom } from '@moeru/std'
import { StreamingSpeechClient, streamingSpeechConfigSchema } from '@proj-airi/provider-inference'
import { Button, FieldCheckbox, FieldSelect } from '@proj-airi/ui'
import { computed, onScopeDispose, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useSpeechStore } from '../../../stores/modules/speech'
import { useProviderConfigStore } from '../../../stores/providers/config'
import { useProviderStore } from '../../../stores/providers/provider'

const { t } = useI18n()
const configs = useProviderConfigStore()
const providers = useProviderStore()
const speech = useSpeechStore()
const emptyConfig = Object.freeze({})
const settings = computed(() => streamingSpeechConfigSchema.parse(configs.getProviderConfig('streaming-speech') ?? emptyConfig))
const model = computed(() => speech.activeSpeechProvider === 'streaming-speech' ? speech.activeSpeechModel || settings.value.model : settings.value.model)
const drama = computed(() => model.value.startsWith('drama-3-'))
const enabled = computed(() => drama.value && settings.value.multiSpeakerEnabled)
const bindings = computed(() => Object.entries(settings.value.speakerReferences))
const references = shallowRef<Awaited<ReturnType<StreamingSpeechClient['references']>>>([])
const loading = shallowRef(false)
const saving = shallowRef(false)
const error = shallowRef('')
let request: AbortController | undefined
onScopeDispose(() => request?.abort())

const options = computed(() => [
  { value: 'none', label: t('settings.pages.providers.provider.streaming-speech.reference-none') },
  { value: 'default', label: t('settings.pages.providers.provider.streaming-speech.reference-service') },
  ...references.value.map(reference => ({ value: reference.id, label: reference.name })),
])

async function refresh() {
  request?.abort()
  const current = new AbortController()
  request = current
  loading.value = true
  error.value = ''
  try {
    const catalog = await new StreamingSpeechClient(settings.value).references(current.signal)
    current.signal.throwIfAborted()
    references.value = catalog
  }
  catch (cause) {
    if (!current.signal.aborted)
      error.value = errorMessageFrom(cause) ?? t('settings.pages.providers.provider.streaming-speech.reference-error')
  }
  finally {
    if (request === current)
      loading.value = false
  }
}
watch(() => settings.value.baseUrl, refresh, { immediate: true })

async function save(patch: { multiSpeakerEnabled?: boolean, speakerReferences?: Record<string, string> }) {
  saving.value = true
  error.value = ''
  try {
    streamingSpeechConfigSchema.parse({ ...settings.value, ...patch })
    await providers.initializeProvider('streaming-speech')
    await configs.patchProviderConfig('streaming-speech', patch)
  }
  catch (cause) {
    error.value = errorMessageFrom(cause) ?? t('settings.pages.providers.provider.streaming-speech.save-error')
  }
  finally {
    saving.value = false
  }
}

async function bind(id: string, reference: string | undefined) {
  if (reference !== undefined)
    await save({ speakerReferences: { ...settings.value.speakerReferences, [id]: reference } })
}

async function add() {
  const id = Array.from({ length: 16 }, (_, index) => String(index)).find(id => !Object.hasOwn(settings.value.speakerReferences, id))
  if (id !== undefined)
    await bind(id, settings.value.referenceId || 'default')
}

async function remove(id: string) {
  const next = { ...settings.value.speakerReferences }
  delete next[id]
  await save({ speakerReferences: next })
}
</script>

<template>
  <fieldset :class="['flex flex-col gap-4', 'border border-neutral-200 rounded-lg p-4 dark:border-neutral-700']">
    <legend>{{ t('settings.pages.providers.provider.streaming-speech.speakers-title') }}</legend>
    <FieldCheckbox
      :model-value="enabled" :disabled="!drama || saving"
      :label="t('settings.pages.providers.provider.streaming-speech.speakers-enabled')"
      :description="t('settings.pages.providers.provider.streaming-speech.speakers-description')"
      @update:model-value="save({ multiSpeakerEnabled: $event })"
    />
    <p v-if="!drama" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
      {{ t('settings.pages.providers.provider.streaming-speech.speakers-drama-only') }}
    </p>
    <template v-if="enabled">
      <p :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        {{ t('settings.pages.providers.provider.streaming-speech.speakers-hint', { marker: '<|speaker:1|>' }) }}
      </p>
      <div v-for="[id, reference] in bindings" :key="id" :class="['flex flex-col gap-2']">
        <FieldSelect
          :model-value="reference" :options="options" :disabled="loading || saving"
          :label="id === '0' ? t('settings.pages.providers.provider.streaming-speech.speaker-narrator') : t('settings.pages.providers.provider.streaming-speech.speaker-label', { id })"
          @update:model-value="bind(id, $event)"
        />
        <Button v-if="id !== '0'" :disabled="saving" @click="remove(id)">
          {{ t('settings.pages.providers.provider.streaming-speech.speaker-remove', { id }) }}
        </Button>
      </div>
      <div :class="['flex flex-wrap gap-2']">
        <Button :disabled="saving || bindings.length >= 16" @click="add">
          {{ t('settings.pages.providers.provider.streaming-speech.speaker-add') }}
        </Button>
        <Button :disabled="loading" @click="refresh">
          {{ t('settings.pages.providers.provider.streaming-speech.reference-refresh') }}
        </Button>
      </div>
    </template>
    <p v-if="error" role="alert" :class="['text-sm text-red-500']">
      {{ error }}
    </p>
  </fieldset>
</template>
