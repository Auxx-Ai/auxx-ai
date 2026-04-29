// apps/web/src/components/kb/ui/settings/layout/layout-tab.tsx
'use client'

import { Form } from '@auxx/ui/components/form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useKnowledgeBaseMutations } from '../../../hooks/use-knowledge-base-mutations'
import type { KnowledgeBase } from '../../../store/knowledge-base-store'
import { registerSettingsSubmit } from '../settings-submit-registry'
import { FooterSection } from './footer-section'
import { HeaderSection } from './header-section'
import { type LayoutFormValues, layoutSchema } from './layout-schema'

interface LayoutTabProps {
  knowledgeBaseId: string
  knowledgeBase: KnowledgeBase
}

function buildDefaults(kb: KnowledgeBase): LayoutFormValues {
  const headerNavigation = (kb.headerNavigation ?? []) as LayoutFormValues['headerNavigation']
  const footerNavigation = (kb.footerNavigation ?? []) as LayoutFormValues['footerNavigation']
  return {
    searchbarPosition: (kb.searchbarPosition as LayoutFormValues['searchbarPosition']) || 'center',
    headerEnabled: kb.headerEnabled ?? true,
    footerEnabled: kb.footerEnabled ?? true,
    headerNavigation,
    footerNavigation,
  }
}

export function LayoutTab({ knowledgeBaseId, knowledgeBase }: LayoutTabProps) {
  const { updateKnowledgeBase, isUpdating } = useKnowledgeBaseMutations()

  const form = useForm<LayoutFormValues>({
    resolver: standardSchemaResolver(layoutSchema),
    defaultValues: buildDefaults(knowledgeBase),
  })

  useEffect(() => {
    if (knowledgeBase) form.reset(buildDefaults(knowledgeBase))
  }, [knowledgeBase, form])

  const onSubmit = async (data: LayoutFormValues) => {
    if (!knowledgeBaseId) return
    await updateKnowledgeBase(knowledgeBaseId, {
      searchbarPosition: data.searchbarPosition,
      headerEnabled: data.headerEnabled,
      footerEnabled: data.footerEnabled,
      headerNavigation: data.headerNavigation,
      footerNavigation: data.footerNavigation,
    } as Partial<KnowledgeBase>)
  }

  useEffect(() => {
    return registerSettingsSubmit('layout', async () => {
      await form.handleSubmit(onSubmit)()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, knowledgeBaseId])

  return (
    <div className='pb-16'>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <HeaderSection form={form} isPending={isUpdating} />
          <FooterSection form={form} isPending={isUpdating} />
        </form>
      </Form>
    </div>
  )
}
