// apps/web/src/components/kb/ui/settings/general/theme-section.tsx
'use client'

import { mergeDraftOverLive } from '@auxx/lib/kb/client'
import { Form, FormField } from '@auxx/ui/components/form'
import { RadioGroup, RadioGroupItemCard } from '@auxx/ui/components/radio-group'
import { Section } from '@auxx/ui/components/section'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { Palette, Sparkles, Square, Waves } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { useDraftSettingsAutosave } from '../../../hooks/use-draft-settings-autosave'
import { type KnowledgeBase, selectDraftedSections } from '../../../store/knowledge-base-store'
import { SectionStatusBadge } from '../section-header'

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

const themeSchema = z.object({
  theme: z.enum(['clean', 'muted', 'gradient', 'bold']).default('clean'),
})

type ThemeFormValues = z.infer<typeof themeSchema>

const lower = (v: string | null | undefined) => (v ? v.toLowerCase() : v)

function buildDefaults(kb: KnowledgeBase): ThemeFormValues {
  const merged = mergeDraftOverLive(kb as any) as KnowledgeBase
  return { theme: (lower(merged.theme) as ThemeFormValues['theme']) || 'clean' }
}

interface ThemeSectionProps {
  knowledgeBaseId: string
  knowledgeBase: KnowledgeBase
}

export function ThemeSection({ knowledgeBaseId, knowledgeBase }: ThemeSectionProps) {
  const form = useForm<ThemeFormValues>({
    resolver: standardSchemaResolver(themeSchema),
    defaultValues: buildDefaults(knowledgeBase),
  })

  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-hydrate on KB switch — autosave keeps the form in sync otherwise
  useEffect(() => {
    form.reset(buildDefaults(knowledgeBase))
  }, [knowledgeBase.id, form])

  const watch = form.watch()
  const { isSaving, lastSavedAt } = useDraftSettingsAutosave(knowledgeBaseId, watch, {
    registryKey: 'theme',
  })
  const drafted = selectDraftedSections(knowledgeBase).has('theme')

  return (
    <Section
      title='Theme'
      description='Pick the visual style for your knowledge base.'
      actions={<SectionStatusBadge drafted={drafted} saving={isSaving} savedAt={lastSavedAt} />}>
      <Form {...form}>
        <FormField
          control={form.control}
          name='theme'
          render={({ field }) => (
            <RadioGroup
              value={field.value}
              onValueChange={field.onChange}
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
      </Form>
    </Section>
  )
}
