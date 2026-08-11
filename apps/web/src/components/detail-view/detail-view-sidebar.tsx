// apps/web/src/components/detail-view/detail-view-sidebar.tsx
'use client'

import { parseRecordId } from '@auxx/lib/field-values/client'
import type { DrawerTabCardDefinition } from '@auxx/lib/resources/client'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import React from 'react'
import { TabCardSection } from '~/components/drawers/base-entity-drawer'
import EntityFields from '~/components/fields/entity-fields'
import DrawerComments from '~/components/global/comments/drawer-comments'
import { useCommentAccess } from '~/components/global/comments/use-comment-access'
import { RecordIdentityHeader } from '~/components/records/ui/record-identity-header'
import { useRecordDrawerReadOnly } from '~/components/records/use-record-drawer-read-only'
import { type RecordId, useCanViewRecordResource } from '~/components/resources'
import { useAccess } from '~/providers/capabilities-provider'
import type { DetailViewSidebarProps } from './types'

/** Memoized EntityFields for performance */
const MemoEntityFields = React.memo(EntityFields)

/**
 * DetailViewSidebar - sidebar component with card header and tabs (Overview, Comments)
 * Supports sidebarCards from config for entity-specific cards (metrics, customer, relationships)
 */
export function DetailViewSidebar({
  recordId,
  record,
  config,
  activeTab,
  onTabChange,
}: DetailViewSidebarProps) {
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
  const { can } = useAccess()
  /**
   * 🔴 **This sidebar rendered its fields unconditionally editable.**
   *
   * `EntityFields` defaults to `readOnly = false`, and this mount passed nothing
   * — so a member holding only `read` on the row (or on the whole definition)
   * got a full edit affordance on the record's full page and a 403 from
   * `assertFieldValueHostsWritable` on save. The drawer's twin
   * (`base-entity-drawer.tsx`) has always threaded a flag; this surface was
   * simply never converted.
   *
   * It is the SAME question the drawer asks, so it uses the same hook and the
   * same per-ROW answer (plan v3/03 §5.2): the `_access` stamp, not
   * `canEditEntity(def)`. Plan v3/04 §10.4 fixed this file's sibling
   * (`DetailViewActions`, the header verbs) and stopped there.
   */
  const readOnly = useRecordDrawerReadOnly(entityDefinitionId, entityInstanceId)
  const { canViewComments } = useCommentAccess(recordId)
  const canViewRecordResource = useCanViewRecordResource()
  const entityType = config.entityType
  // Layer-2 capability gate — drop cards (header included) the viewer lacks the
  // key for, mirroring the card's router procedure gate (e.g. billing → dispatch).
  // Layer-3 `recordResource` gate for cards that are purely another definition's
  // records — the twin of the drawer's `TabCards` filter.
  const sidebarCards = config.sidebarCards
    ?.filter((c) => !c.permissionKey || can(c.permissionKey))
    .filter((c) => canViewRecordResource(c.recordResource))

  const beforeCards = sidebarCards?.filter((c) => c.position === 'before') ?? []
  const afterCards = sidebarCards?.filter((c) => (c.position ?? 'after') === 'after') ?? []
  const visibleSidebarTabs = config.sidebarTabs.filter(
    (tab) => tab.value !== 'comments' || canViewComments
  )
  const visibleActiveTab = visibleSidebarTabs.some((tab) => tab.value === activeTab)
    ? activeTab
    : (visibleSidebarTabs[0]?.value ?? activeTab)

  return (
    <div className='h-full flex flex-col'>
      {/* Card header */}
      <RecordIdentityHeader recordId={recordId} readOnly={readOnly} />

      {/* Sidebar tabs */}
      <Tabs
        value={visibleActiveTab}
        onValueChange={onTabChange}
        className='flex-1 flex flex-col min-h-0'>
        <TabsList
          className='border-b w-full justify-start rounded-b-none bg-primary-100'
          variant='outline'>
          {visibleSidebarTabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} variant='outline'>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value='overview' className='flex-1 overflow-y-auto'>
          {/* Before cards (e.g., metrics) */}
          <SidebarCards
            cards={beforeCards}
            entityType={entityType}
            entityInstanceId={entityInstanceId}
            recordId={recordId}
            record={record}
          />

          {/* `canEdit` here gates FIELD MANAGEMENT (Add field), which
              `EntityFields` already floors on `canAdministerDef`. Passing
              `!readOnly` matches the drawer, so a row the member cannot edit
              does not offer schema edits either. */}
          <MemoEntityFields
            recordId={recordId}
            className='m-4'
            readOnly={readOnly}
            canEdit={!readOnly}
          />

          {/* After cards (e.g., customer, relationships) */}
          <SidebarCards
            cards={afterCards}
            entityType={entityType}
            entityInstanceId={entityInstanceId}
            recordId={recordId}
            record={record}
          />
        </TabsContent>

        {canViewComments && (
          <TabsContent value='comments' className='flex-1 overflow-y-auto'>
            <DrawerComments recordId={recordId} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}

/**
 * Renders sidebar card components for the given card definitions, through the
 * SAME `TabCardSection` wrapper the drawer uses (`base-entity-drawer.tsx`,
 * exported for exactly this) rather than a local `<h4>` + lazy loader.
 *
 * The local copy diverged from the drawer in three ways that were all visible:
 * it rendered a sentence-case heading with no Section chrome, so the same card
 * (e.g. Billing) looked like a different component on the contact page than in
 * the contact drawer; it ignored `card.icon`; and it provided no
 * `DrawerCardActionsProvider`, so a card portaling header actions through
 * `DrawerCardActions` silently rendered none — `quote:jobs` is a sidebar card
 * and its "Create job" button simply did not exist on the quote detail page.
 */
function SidebarCards({
  cards,
  entityType,
  entityInstanceId,
  recordId,
  record,
}: {
  cards: DrawerTabCardDefinition[]
  entityType: string
  entityInstanceId: string
  recordId: RecordId
  record: Record<string, unknown>
}) {
  if (!cards.length) return null

  return (
    <>
      {cards.map((card) => (
        <TabCardSection
          key={card.value}
          card={card}
          entityType={entityType}
          entityInstanceId={entityInstanceId}
          recordId={recordId}
          record={record}
        />
      ))}
    </>
  )
}
