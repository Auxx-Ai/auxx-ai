// packages/lib/src/constants/provider-icons.ts

export interface ProviderTheme {
  icon: string
  color: string
  bgColor: string
  textColor: string
  borderColor?: string
}

export const PROVIDER_THEMES: Record<string, ProviderTheme> = {
  openai: {
    icon: 'openai',
    color: '#10A37F', // OpenAI green
    bgColor: 'bg-emerald-500',
    textColor: 'text-white',
    borderColor: 'border-emerald-200',
  },
  anthropic: {
    icon: 'anthropic',
    color: '#D97706', // Orange
    bgColor: 'bg-orange-500',
    textColor: 'text-white',
    borderColor: 'border-orange-200',
  },
  google: {
    icon: 'google',
    color: '#4285F4', // Google blue
    bgColor: 'bg-blue-600',
    textColor: 'text-white',
    borderColor: 'border-blue-200',
  },
  groq: {
    icon: 'groq',
    color: '#000000', // Black
    bgColor: 'bg-black',
    textColor: 'text-white',
    borderColor: 'border-gray-200',
  },
  deepseek: {
    icon: 'deepseek',
    color: '#4F46E5', // Indigo
    bgColor: 'bg-indigo-600',
    textColor: 'text-white',
    borderColor: 'border-indigo-200',
  },
  qwen: {
    icon: 'qwen',
    color: '#615EFF', // Qwen purple
    bgColor: 'bg-violet-600',
    textColor: 'text-white',
    borderColor: 'border-violet-200',
  },
  kimi: {
    icon: 'kimi',
    color: '#027AFF', // Kimi blue
    bgColor: 'bg-blue-500',
    textColor: 'text-white',
    borderColor: 'border-blue-200',
  },
}

// Icon mappings for backwards compatibility
export const PROVIDER_ICON_LETTERS: Record<string, string> = {
  openai: 'AI',
  anthropic: 'C',
  google: 'G',
  groq: 'Q',
  deepseek: 'D',
  qwen: 'Qw',
  kimi: 'Ki',
}
