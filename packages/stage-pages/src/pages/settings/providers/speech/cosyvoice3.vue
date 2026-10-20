<script setup lang="ts">
import type { SpeechProvider } from '@xsai-ext/providers/utils'

import { COSYVOICE3_MODEL } from '@proj-airi/provider-inference'
import { CosyVoice3Controls, SpeechPlayground, SpeechProviderSettings } from '@proj-airi/stage-ui/components'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { Callout } from '@proj-airi/ui'
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const providerId = 'cosyvoice3'
const speech = useSpeechStore()
const providers = useProviderStore()
const configs = useProviderConfigStore()
const emptyVoices = Object.freeze([])
const voices = computed(() => speech.availableVoices[providerId] ?? emptyVoices)

onMounted(async () => {
  await speech.loadVoicesForProvider(providerId)
})

async function preview(input: string, voice: string) {
  const provider = await providers.getProviderInstance<SpeechProvider>(providerId)
  return speech.speech(provider, COSYVOICE3_MODEL, input, voice, configs.getProviderConfig(providerId))
}
</script>

<template>
  <Callout theme="violet" :label="t('settings.pages.providers.provider.cosyvoice3.service-title')">
    {{ t('settings.pages.providers.provider.cosyvoice3.service-description') }}
  </Callout>
  <SpeechProviderSettings :provider-id="providerId" :default-model="COSYVOICE3_MODEL" hide-api-key>
    <template #voice-settings>
      <CosyVoice3Controls />
    </template>
    <template #playground>
      <SpeechPlayground
        :available-voices="voices" :generate-speech="preview"
        :api-key-configured="true" :supports-ssml="false"
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
