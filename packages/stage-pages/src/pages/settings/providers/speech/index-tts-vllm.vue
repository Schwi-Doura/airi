<script setup lang="ts">
import {
  IndexTtsControls,
  SpeechPlayground,
  SpeechProviderSettings,
} from '@proj-airi/stage-ui/components'
import { useIndexTtsPreview } from '@proj-airi/stage-ui/libs/providers/speech/index-tts/preview'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { Callout, FieldSelect } from '@proj-airi/ui'
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const providerId = 'index-tts-vllm'
const defaultModel = 'IndexTTS-2.5'

const speechStore = useSpeechStore()
const providersStore = useProviderStore()
const providerStore = useProviderConfigStore()
const preview = useIndexTtsPreview()
const language = computed(() => String(providerStore.getProviderConfig(providerId)?.language ?? 'auto'))
const languageOptions = computed(() => [
  { value: 'auto', label: t('settings.pages.providers.provider.index-tts-vllm.language-auto') },
  { value: 'ZH', label: '中文' },
  { value: 'EN', label: 'English' },
  { value: 'JA', label: '日本語' },
  { value: 'ES', label: 'Español' },
  { value: 'AR', label: 'العربية' },
])
const availableVoices = computed(() => {
  return speechStore.availableVoices[providerId] || []
})

onMounted(async () => {
  await speechStore.loadVoicesForProvider(providerId)
})

async function saveLanguage(value: string | undefined) {
  if (!value)
    return
  await providersStore.initializeProvider(providerId)
  await providerStore.patchProviderConfig(providerId, { language: value })
  await providersStore.validateProvider(providerId)
}

async function handleGenerateSpeech(input: string, voiceId: string) {
  return preview.generateSpeech(input, voiceId)
}
</script>

<template>
  <Callout
    theme="violet"
    :label="t('settings.pages.providers.provider.index-tts-vllm.local-service-title')"
  >
    {{ t('settings.pages.providers.provider.index-tts-vllm.local-service-description') }}
  </Callout>

  <SpeechProviderSettings :provider-id="providerId" :default-model="defaultModel" hide-api-key>
    <template #voice-settings>
      <FieldSelect
        :model-value="language"
        :options="languageOptions"
        :label="t('settings.pages.providers.provider.index-tts-vllm.language')"
        :description="t('settings.pages.providers.provider.index-tts-vllm.language-description')"
        @update:model-value="saveLanguage"
      />
      <IndexTtsControls />
    </template>
    <template #playground>
      <SpeechPlayground
        :available-voices="availableVoices" :generate-speech="handleGenerateSpeech"
        :api-key-configured="true"
        :supports-ssml="false"
        default-text="Hello! This is a test of the voice synthesis."
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
