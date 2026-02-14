// apps/web/src/components/workflow/ui/model-parameter/constants.ts

import type { ModelParameterRule } from './types'

export const PROVIDER_WITH_PRESET_TONE = ['openai', 'anthropic']

export const stopParameterRule: ModelParameterRule = {
  default: [],
  help: 'Up to four sequences where the API will stop generating further tokens. The returned text will not contain the stop sequence.',
  label: 'Stop sequences',
  name: 'stop',
  required: false,
  type: 'tag',
  tagPlaceholder: 'Enter sequence and press Tab',
}

// Tone presets for parameter configuration
export const TONE_LIST = [
  { id: 1, name: 'creative', config: { temperature: 0.8, top_p: 0.9 } },
  { id: 2, name: 'balanced', config: { temperature: 0.7, top_p: 0.85 } },
  { id: 3, name: 'precise', config: { temperature: 0.3, top_p: 0.75 } },
]
