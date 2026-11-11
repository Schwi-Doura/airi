<script setup lang="ts">
import { STREAMING_SPEECH_MODEL } from '@proj-airi/provider-inference'
import { SpeechPlayground, SpeechProviderSettings, StreamingSpeechControls } from '@proj-airi/stage-ui/components'
import { useProviderValidation } from '@proj-airi/stage-ui/composables/use-provider-validation'
import { useStreamingSpeechPreview } from '@proj-airi/stage-ui/libs/providers/speech/streaming-speech/preview'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { Callout } from '@proj-airi/ui'
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const providerId = 'streaming-speech'
const speech = useSpeechStore()
const configs = useProviderConfigStore()
const preview = useStreamingSpeechPreview()
const emptyVoices = Object.freeze([])
const voices = computed(() => speech.availableVoices[providerId] ?? emptyVoices)
const { isValid, validationMessage } = useProviderValidation(providerId)

watch(() => configs.configuredProviders[providerId], async (configured) => {
  if (configured)
    await speech.loadVoicesForProvider(providerId)
}, { immediate: true })

async function generateSpeech(input: string, voice: string) {
  const model = speech.activeSpeechProvider === providerId ? speech.activeSpeechModel : undefined
  return preview.generateSpeech(input, voice, model)
}
</script>

<template>
  <Callout theme="violet" :label="t('settings.pages.providers.provider.streaming-speech.service-title')">
    {{ t('settings.pages.providers.provider.streaming-speech.service-description') }}
  </Callout>
  <SpeechProviderSettings :provider-id="providerId" :default-model="STREAMING_SPEECH_MODEL" hide-api-key>
    <template #basic-settings>
      <p v-if="!isValid && validationMessage" role="alert" :class="['text-sm text-red-500']">
        {{ validationMessage }}
      </p>
    </template>
    <template #voice-settings>
      <StreamingSpeechControls />
    </template>
    <template #playground>
      <SpeechPlayground :available-voices="voices" :generate-speech="generateSpeech" :api-key-configured="true" :supports-ssml="false" />
    </template>
  </SpeechProviderSettings>
</template>

<route lang="yaml">
meta:
  layout: settings
  stageTransition:
    name: slide
</route>
