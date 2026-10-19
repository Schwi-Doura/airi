<script setup lang="ts">
import type { SpeechProvider } from '@xsai-ext/providers/utils'

import { SpeechPlayground, SpeechProviderSettings } from '@proj-airi/stage-ui/components'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { FieldInput, FieldSelect } from '@proj-airi/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const providerId = 'novelai-speech'
const providersStore = useProviderStore()
const providerStore = useProviderConfigStore()
const speechStore = useSpeechStore()
const { t } = useI18n()

const model = computed(() => String(providerStore.getProviderConfig(providerId)?.model || 'v2'))
const seed = computed(() => String(providerStore.getProviderConfig(providerId)?.seed || 'Maria'))
async function saveConfig(patch: Record<string, unknown>) {
  await providersStore.initializeProvider(providerId)
  await providerStore.patchProviderConfig(providerId, patch)
  await providersStore.validateProvider(providerId)
}
const availableVoices = computed(() => speechStore.availableVoices[providerId] || [])
const apiKeyConfigured = computed(() => !!providerStore.getProviderConfig(providerId)?.apiKey)

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
        :model-value="model"
        :label="t('settings.pages.providers.provider.novelai-speech.model')"
        :options="[{ label: 'TTS v1', value: 'v1' }, { label: 'TTS v2', value: 'v2' }]"
        @update:model-value="value => saveConfig({ model: value })"
      />
      <FieldInput
        :model-value="seed"
        :label="t('settings.pages.providers.provider.novelai-speech.seed')"
        :description="t('settings.pages.providers.provider.novelai-speech.seed-description')"
        placeholder="seedmix:Kayra+Clio"
        @update:model-value="value => saveConfig({ seed: value })"
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
