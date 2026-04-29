// apps/web/src/components/kb/ui/settings/general/theme-section.tsx
'use client'

import { FormField } from '@auxx/ui/components/form'
import { RadioGroup, RadioGroupItemCard } from '@auxx/ui/components/radio-group'
import { Section } from '@auxx/ui/components/section'
import { Palette, Sparkles, Square, Waves } from 'lucide-react'
import type { UseFormReturn } from 'react-hook-form'
import type { GeneralFormValues } from './general-schema'

const themes = [
  {
    value: 'clean' as const,
    label: 'Clean',
    icon: <Sparkles />,
    description: 'Minimal white background',
  },
  {
    value: 'muted' as const,
    label: 'Muted',
    icon: <Waves />,
    description: 'Soft, low-contrast palette',
  },
  {
    value: 'bold' as const,
    label: 'Bold',
    icon: <Square />,
    description: 'High-contrast, modern',
  },
  {
    value: 'gradient' as const,
    label: 'Gradient',
    icon: <Palette />,
    description: 'Colourful gradient surface',
  },
]

interface ThemeSectionProps {
  form: UseFormReturn<GeneralFormValues>
  isPending: boolean
}

export function ThemeSection({ form, isPending }: ThemeSectionProps) {
  return (
    <Section title='Theme' description='Pick the visual style for your knowledge base.'>
      <FormField
        control={form.control}
        name='theme'
        render={({ field }) => (
          <RadioGroup
            value={field.value}
            onValueChange={field.onChange}
            disabled={isPending}
            className='grid gap-2 sm:grid-cols-2'>
            {themes.map((t) => (
              <RadioGroupItemCard
                key={t.value}
                value={t.value}
                label={t.label}
                icon={t.icon}
                description={t.description}
              />
            ))}
          </RadioGroup>
        )}
      />
    </Section>
  )
}
