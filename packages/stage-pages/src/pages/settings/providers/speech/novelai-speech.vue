<script setup lang="ts">
import type { SpeechProvider } from '@xsai-ext/providers/utils'

import { SpeechPlayground, SpeechProviderSettings } from '@proj-airi/stage-ui/components'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { FieldInput, FieldSelect } from '@proj-airi/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const providerId = 'novelai-speech'
const providersStore = useProvidersStore()
const speechStore = useSpeechStore()
const { t } = useI18n()

const model = computed({
  get: () => String(providersStore.providers[providerId]?.model || 'v2'),
  set: (value: string) => {
    providersStore.initializeProvider(providerId)
    providersStore.providers[providerId].model = value
  },
})
const seed = computed({
  get: () => String(providersStore.providers[providerId]?.seed || 'Maria'),
  set: (value: string) => {
    providersStore.initializeProvider(providerId)
    providersStore.providers[providerId].seed = value
  },
})
const availableVoices = computed(() => speechStore.availableVoices[providerId] || [])
const apiKeyConfigured = computed(() => !!providersStore.providers[providerId]?.apiKey)

async function generateSpeech(input: string, voice: string) {
  const provider = await providersStore.getProviderInstance<SpeechProvider>(providerId)
  if (!provider)
    throw new Error('NovelAI TTS is not configured.')

  return speechStore.speech(provider, model.value, input, voice || 'custom')
}
</script>

<template>
  <SpeechProviderSettings :provider-id="providerId" default-model="v2" placeholder="Persistent API Token">
    <template #voice-settings>
      <FieldSelect
        v-model="model"
        :label="t('settings.pages.providers.provider.novelai-speech.model')"
        :options="[{ label: 'TTS v1', value: 'v1' }, { label: 'TTS v2', value: 'v2' }]"
      />
      <FieldInput
        v-model="seed"
        :label="t('settings.pages.providers.provider.novelai-speech.seed')"
        :description="t('settings.pages.providers.provider.novelai-speech.seed-description')"
        placeholder="seedmix:Kayra+Clio"
      />
    </template>
    <template #playground>
      <SpeechPlayground
        :available-voices="availableVoices"
        :generate-speech="generateSpeech"
        :api-key-configured="apiKeyConfigured"
      />
    </template>
  </SpeechProviderSettings>
</template>

<route lang="yaml">
meta:
  layout: settings
  stageTransition:
    name: slide
</route>
