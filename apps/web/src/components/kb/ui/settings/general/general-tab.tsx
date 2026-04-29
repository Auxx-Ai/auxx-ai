// apps/web/src/components/kb/ui/settings/general/general-tab.tsx
'use client'

import { Form } from '@auxx/ui/components/form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useKnowledgeBaseMutations } from '../../../hooks/use-knowledge-base-mutations'
import type { KnowledgeBase } from '../../../store/knowledge-base-store'
import { registerSettingsSubmit } from '../settings-submit-registry'
import { ColorsSection } from './colors-section'
import { type GeneralFormValues, generalSchema } from './general-schema'
import { IdentitySection } from './identity-section'
import { LogosSection } from './logos-section'
import { ModesSection } from './modes-section'
import { StylingSection } from './styling-section'
import { ThemeSection } from './theme-section'

interface GeneralTabProps {
  knowledgeBaseId: string
  knowledgeBase: KnowledgeBase
}

// Older rows may have capitalized values (e.g. 'Regular'); the zod enums are lowercase.
const lower = (v: string | null | undefined) => (v ? v.toLowerCase() : v)

function buildDefaults(kb: KnowledgeBase): GeneralFormValues {
  return {
    name: kb.name,
    slug: kb.slug,
    description: kb.description || '',
    isPublic: kb.isPublic,
    customDomain: kb.customDomain || '',
    logoDark: kb.logoDark || '',
    logoLight: kb.logoLight || '',
    theme: (lower(kb.theme) as GeneralFormValues['theme']) || 'clean',
    showMode: kb.showMode,
    defaultMode: (lower(kb.defaultMode) as GeneralFormValues['defaultMode']) || 'light',
    primaryColorLight: kb.primaryColorLight || '#346DDB',
    primaryColorDark: kb.primaryColorDark || '#346DDB',
    tintColorLight: kb.tintColorLight || '#D7DEEC',
    tintColorDark: kb.tintColorDark || '#010309',
    infoColorLight: kb.infoColorLight || '#787878',
    infoColorDark: kb.infoColorDark || '#787878',
    successColorLight: kb.successColorLight || '#00C950',
    successColorDark: kb.successColorDark || '#00C950',
    warningColorLight: kb.warningColorLight || '#FE9A00',
    warningColorDark: kb.warningColorDark || '#FE9A00',
    dangerColorLight: kb.dangerColorLight || '#FB2C36',
    dangerColorDark: kb.dangerColorDark || '#FB2C36',
    fontFamily: kb.fontFamily || 'inter',
    iconsFamily: (lower(kb.iconsFamily) as GeneralFormValues['iconsFamily']) || 'regular',
    cornerStyle: (lower(kb.cornerStyle) as GeneralFormValues['cornerStyle']) || 'rounded',
    sidebarListStyle:
      (lower(kb.sidebarListStyle) as GeneralFormValues['sidebarListStyle']) || 'default',
    searchbarPosition:
      (lower(kb.searchbarPosition) as GeneralFormValues['searchbarPosition']) || 'center',
  }
}

export function GeneralTab({ knowledgeBaseId, knowledgeBase }: GeneralTabProps) {
  const { updateKnowledgeBase, isUpdating } = useKnowledgeBaseMutations()

  const form = useForm<GeneralFormValues>({
    resolver: standardSchemaResolver(generalSchema),
    defaultValues: buildDefaults(knowledgeBase),
  })

  // Re-hydrate when the underlying KB changes (e.g., on switch).
  useEffect(() => {
    if (knowledgeBase) form.reset(buildDefaults(knowledgeBase))
  }, [knowledgeBase, form])

  const onSubmit = async (data: GeneralFormValues) => {
    if (!knowledgeBaseId) return
    await updateKnowledgeBase(knowledgeBaseId, data as Partial<KnowledgeBase>)
  }

  const onInvalid = (errors: unknown) => {
    console.warn('[GeneralTab] form validation failed', errors)
  }

  // Register with the global "Save Changes" button.
  useEffect(() => {
    return registerSettingsSubmit('general', async () => {
      await form.handleSubmit(onSubmit, onInvalid)()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, knowledgeBaseId])

  return (
    <div className='relative pb-16'>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <IdentitySection form={form} isPending={isUpdating} />
          <LogosSection form={form} isPending={isUpdating} knowledgeBaseId={knowledgeBaseId} />
          <ThemeSection form={form} isPending={isUpdating} />
          <ColorsSection form={form} isPending={isUpdating} />
          <ModesSection form={form} isPending={isUpdating} />
          <StylingSection form={form} isPending={isUpdating} />
        </form>
      </Form>
    </div>
  )
}
