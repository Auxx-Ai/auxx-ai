// apps/web/src/components/kb/ui/settings/general/identity-section.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { Form, FormField } from '@auxx/ui/components/form'
import { Section } from '@auxx/ui/components/section'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { useKnowledgeBaseMutations } from '../../../hooks/use-knowledge-base-mutations'
import type { KnowledgeBase } from '../../../store/knowledge-base-store'
import { registerSettingsSubmit } from '../settings-submit-registry'

const identitySchema = z.object({
  slug: z
    .string()
    .min(1, 'Slug is required')
    .regex(/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens'),
  customDomain: z.string().nullish(),
  visibility: z.enum(['PUBLIC', 'INTERNAL']).default('PUBLIC'),
})

type IdentityFormValues = z.infer<typeof identitySchema>

const VISIBILITY_OPTIONS = [
  { label: 'Public', value: 'PUBLIC' },
  { label: 'Internal — sign-in required', value: 'INTERNAL' },
]

interface IdentitySectionProps {
  knowledgeBaseId: string
  knowledgeBase: KnowledgeBase
}

function buildDefaults(kb: KnowledgeBase): IdentityFormValues {
  return {
    slug: kb.slug,
    customDomain: kb.customDomain || '',
    visibility: (kb.visibility as IdentityFormValues['visibility']) ?? 'PUBLIC',
  }
}

export function IdentitySection({ knowledgeBaseId, knowledgeBase }: IdentitySectionProps) {
  const { updateKnowledgeBase, isUpdating } = useKnowledgeBaseMutations()

  const form = useForm<IdentityFormValues>({
    resolver: standardSchemaResolver(identitySchema),
    defaultValues: buildDefaults(knowledgeBase),
  })

  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-hydrate on KB switch
  useEffect(() => {
    form.reset(buildDefaults(knowledgeBase))
  }, [knowledgeBase.id, form])

  const onSubmit = async (data: IdentityFormValues) => {
    await updateKnowledgeBase(knowledgeBaseId, {
      slug: data.slug,
      visibility: data.visibility,
    })
  }

  // Register with the global Save button — only triggers a submit if the form
  // is currently dirty so we don't fire spurious requests for the live API.
  // biome-ignore lint/correctness/useExhaustiveDependencies: form.handleSubmit / form.formState are stable enough for this side effect
  useEffect(() => {
    return registerSettingsSubmit(`${knowledgeBaseId}:identity`, async () => {
      if (!form.formState.isDirty) return
      await form.handleSubmit(onSubmit)()
    })
  }, [knowledgeBaseId])

  return (
    <Section title='Identity' description='URL and access for this knowledge base.'>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <FieldPanel orientation='responsive' className='p-0' resizeId='kb-settings'>
            <FormField
              control={form.control}
              name='slug'
              render={({ field, fieldState }) => (
                <FieldPanelRow
                  title='URL slug'
                  description='Used in the URL of your knowledge base.'
                  type={BaseType.STRING}
                  showIcon
                  isRequired
                  validationError={fieldState.error?.message}>
                  <FieldInputAdapter
                    fieldType={FieldType.TEXT}
                    value={field.value}
                    onChange={(v) => field.onChange(v ?? '')}
                    placeholder='my-knowledge-base'
                    disabled={isUpdating}
                  />
                </FieldPanelRow>
              )}
            />

            <FormField
              control={form.control}
              name='visibility'
              render={({ field, fieldState }) => (
                <FieldPanelRow
                  title='Visibility'
                  description='Public knowledge bases are accessible to anyone with the link. Internal knowledge bases require visitors to sign in and be a member of your organization.'
                  type={BaseType.ENUM}
                  showIcon
                  validationError={fieldState.error?.message}>
                  <FieldInputAdapter
                    fieldType={FieldType.SINGLE_SELECT}
                    fieldOptions={{ options: VISIBILITY_OPTIONS }}
                    value={field.value ?? 'PUBLIC'}
                    onChange={(v) => field.onChange((v as string[])[0] ?? 'PUBLIC')}
                    placeholder='Public'
                    disabled={isUpdating}
                    triggerProps={{ className: 'ps-0 pe-1 w-full' }}
                  />
                </FieldPanelRow>
              )}
            />
          </FieldPanel>
        </form>
      </Form>
    </Section>
  )
}
