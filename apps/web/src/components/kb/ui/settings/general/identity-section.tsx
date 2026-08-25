// apps/web/src/components/kb/ui/settings/general/identity-section.tsx
'use client'

import { mergeDraftOverLive } from '@auxx/lib/kb/client'
import { Button } from '@auxx/ui/components/button'
import { Section } from '@auxx/ui/components/section'
import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { useKnowledgeBaseMutations } from '../../../hooks/use-knowledge-base-mutations'
import type { KnowledgeBase } from '../../../store/knowledge-base-store'
import {
  KnowledgeBaseDialog,
  type KnowledgeBaseFormValues,
} from '../../dialogs/kb-knowledge-base-dialog'

/** Mirrors the publish dialog's three-way access choice. Display only. */
const ACCESS_LABEL = {
  public: 'Public (anyone can read it)',
  unlisted: 'Unlisted (direct link only)',
  internal: 'Internal (sign-in required)',
} as const

interface IdentitySectionProps {
  knowledgeBaseId: string
  knowledgeBase: KnowledgeBase
}

/**
 * Name and slug.
 *
 * Unlike every other settings section this one does NOT autosave into the draft
 * envelope: `slug` is the live public URL and renaming it has a known
 * cache-busting hazard, so it is read-only here and changed deliberately
 * through the existing edit dialog rather than by a debounce. `name` IS
 * draftable and rides along in that same dialog — the split write is the one
 * `knowledge-base-card.tsx` already established.
 *
 * Access is shown read-only. `publishStatus` and `visibility` are one user
 * choice and are edited together in `KBSitePublishDialog`; duplicating an
 * editor here would let the two screens disagree, which is the bug that
 * motivated merging them.
 */
export function IdentitySection({ knowledgeBaseId, knowledgeBase }: IdentitySectionProps) {
  const { updateKnowledgeBase, updateDraftSettings, isUpdating, isUpdatingDraft } =
    useKnowledgeBaseMutations()
  const [editOpen, setEditOpen] = useState(false)

  const accessMode: keyof typeof ACCESS_LABEL =
    knowledgeBase.visibility === 'INTERNAL'
      ? 'internal'
      : knowledgeBase.publishStatus === 'UNLISTED'
        ? 'unlisted'
        : 'public'

  // Sibling sections all read through the draft, so a staged name shows here too.
  const merged = mergeDraftOverLive(knowledgeBase as Record<string, unknown>) as KnowledgeBase

  const handleEditSubmit = async (values: KnowledgeBaseFormValues) => {
    // Same split as `knowledge-base-card.tsx`: slug is live, name is drafted.
    if (values.slug !== knowledgeBase.slug) {
      await updateKnowledgeBase(knowledgeBaseId, { slug: values.slug })
    }
    if (values.name !== merged.name) {
      await updateDraftSettings(knowledgeBaseId, { name: values.name })
    }
    setEditOpen(false)
  }

  return (
    <Section title='Identity' description='URL and access for this knowledge base.'>
      <FieldPanel orientation='responsive' className='p-0' resizeId='kb-settings'>
        <FieldPanelRow
          title='URL slug'
          description='Used in the URL of your knowledge base. Changing it breaks existing links.'
          type={BaseType.STRING}
          showIcon>
          <div className='flex min-h-8 w-full items-center justify-between gap-2'>
            <span className='truncate font-mono text-muted-foreground text-sm'>
              /{knowledgeBase.slug}
            </span>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => setEditOpen(true)}
              disabled={isUpdating || isUpdatingDraft}
              aria-label='Edit name and slug'>
              <Pencil />
            </Button>
          </div>
        </FieldPanelRow>

        <FieldPanelRow
          title='Access'
          description='Changed from the Publish menu, which sets who can see the site in one place.'
          type={BaseType.ENUM}
          showIcon>
          <span className='flex min-h-8 items-center text-muted-foreground text-sm'>
            {ACCESS_LABEL[accessMode]}
          </span>
        </FieldPanelRow>
      </FieldPanel>

      {editOpen && (
        <KnowledgeBaseDialog
          open
          onOpenChange={setEditOpen}
          onSubmit={handleEditSubmit}
          initialValues={{ name: merged.name, slug: knowledgeBase.slug }}
          isSubmitting={isUpdating || isUpdatingDraft}
          mode='edit'
        />
      )}
    </Section>
  )
}
