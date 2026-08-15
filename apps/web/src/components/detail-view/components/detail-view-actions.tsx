// apps/web/src/components/detail-view/components/detail-view-actions.tsx
'use client'

import { parseRecordId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import { Kbd } from '@auxx/ui/components/kbd'
import { Share2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { DuplicateIndicatorButton } from '~/components/duplicates/ui/duplicate-indicator-button'
import { FavoriteStarButton } from '~/components/favorites/ui/favorite-star-button'
import { GranularPermissionsGate } from '~/components/mail-permissions/ui/granular-permissions-gate'
import { InstanceShareAvatars } from '~/components/permissions/ui/instance-share-avatars'
import { InstanceShareDialog } from '~/components/permissions/ui/instance-share-dialog'
import { RecordRequestAccessPopover } from '~/components/permissions/ui/record-request-access-popover'
import { useRecordShortcuts } from '~/components/records/hooks/use-record-shortcuts'
import { RECORD_HEADER_GHOST, RecordActionsMenu } from '~/components/records/record-actions-menu'
import { useRecordAccess } from '~/components/resources'
import { MassWorkflowTriggerDialog } from '~/components/workflow/mass-workflow-trigger-dialog'
import type { DetailViewActionsProps } from '../types'

/**
 * The detail page's header action cluster:
 * `[who it's shared with + Share | Request access] [★] [⋮]`
 *
 * This used to be a row of eight outline buttons, five of which did nothing:
 * Archive, Delete, Spam and Run Workflow were `console.log` stubs behind confirm
 * dialogs that led nowhere, and Groups set a `useState` no JSX read (no
 * group-assignment dialog exists anywhere in the app). Spam had no server
 * mutation at all. Everything real now lives in the shared
 * {@link RecordActionsMenu}, which the drawer and the records-table row use too,
 * so the three surfaces can no longer disagree about what a record type offers.
 *
 * Three controls stay OUT of the menu, each for its own reason:
 *
 * - **Share**, with the shared-with avatars to its left. Both are gated on
 *   `canShare` (an `admin` row), which also keeps the avatars' per-record query
 *   off every other viewer — who else can see a record is not something a `read`
 *   member should be able to enumerate.
 * - **Request access**, because it is the one control that ADDS capability, and
 *   burying the way out of a dead end behind a kebab is exactly backwards. It
 *   and Share are mutually exclusive in practice: the ask only appears at `read`,
 *   sharing only at `admin`.
 * - **The favourite star**, because it REPORTS state (a filled star means
 *   favourited) and state you must open a menu to read is state you may as well
 *   not show. It is also deliberately ungated — favouriting is a personal
 *   bookmark keyed to the viewer, not a write on the record.
 *
 * Both promoted items are passed to the menu as `omitItems` so they are not also
 * offered inside it.
 *
 * This is also the detail page's ONE mount of {@link useRecordShortcuts} — `R`,
 * `F`, `W` and `Shift+S`. It goes here rather than in the page shell because the
 * anchors those keys need (the request trigger, the star, the share dialog) are
 * all already rendered here, and a second mount anywhere would double-fire every
 * key.
 */
export function DetailViewActions({
  entityType,
  recordId,
  record,
  backUrl,
}: DetailViewActionsProps) {
  const router = useRouter()
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
  const { access, canShare } = useRecordAccess(recordId)

  /**
   * `R` / `F` / `W` / `Shift+S` for the record this page is about. `E` is not
   * bound — this page IS the expanded view. Mounted HERE rather than in the page
   * shell because this component already renders every anchor the keys need:
   * the request-access trigger, the share dialog and the favourite star.
   */
  const {
    requestAccessOpen,
    setRequestAccessOpen,
    shareOpen,
    setShareOpen,
    workflowOpen,
    setWorkflowOpen,
  } = useRecordShortcuts({ recordId, enabled: true })

  return (
    <div className='flex items-center gap-2'>
      {canShare && (
        <GranularPermissionsGate>
          <div className='flex items-center gap-1.5'>
            {/* Avatars lead: they are the STATE (who can see this), the button
                is the action on it. Reading left-to-right you learn the answer
                before you're offered the way to change it. */}
            <InstanceShareAvatars recordId={recordId} />
            <Button
              variant='ghost'
              size='sm'
              className={RECORD_HEADER_GHOST}
              onClick={() => setShareOpen(true)}>
              <Share2 />
              Share
              <Kbd variant='outline' size='sm'>
                ⇧S
              </Kbd>
            </Button>
          </div>
        </GranularPermissionsGate>
      )}

      {/* Label follows the ladder rather than this call site: `none → "Request
          access"`, `read → "Request edit access"`. `edit`/`admin` render nothing
          — there is nothing left to ask for. */}
      {access === 'read' && (
        <GranularPermissionsGate>
          <RecordRequestAccessPopover
            entityDefinitionId={entityDefinitionId}
            entityInstanceId={entityInstanceId}
            variant='header'
            shortcut='R'
            open={requestAccessOpen}
            onOpenChange={setRequestAccessOpen}
          />
        </GranularPermissionsGate>
      )}

      {/* Renders nothing unless this record has open duplicate pairs. Same
          component the drawer header mounts — one affordance, two surfaces,
          exactly like the star beside it. */}
      <DuplicateIndicatorButton
        recordId={recordId}
        size='icon-xs'
        className={RECORD_HEADER_GHOST}
      />

      <FavoriteStarButton
        targetType='ENTITY_INSTANCE'
        targetIds={{ entityDefinitionId, entityInstanceId }}
        size='icon-xs'
        className={RECORD_HEADER_GHOST}
        shortcut='F'
      />

      <RecordActionsMenu
        recordId={recordId}
        entityType={entityType}
        record={record}
        surface='page'
        omitItems={['share', 'request-access']}
        // The record this page IS was just deleted — staying here would render
        // the not-found screen for a row the member deleted themselves.
        onDeleted={() => backUrl && router.push(backUrl)}
      />

      {shareOpen && (
        <InstanceShareDialog recordId={recordId} open={shareOpen} onOpenChange={setShareOpen} />
      )}

      {/* `W`'s target. The menu's own "Run workflow" submenu triggers a chosen
          workflow directly; the shortcut has nothing chosen yet, so it opens the
          picker — the same dialog mail's `W` opens for a thread. */}
      {workflowOpen && (
        <MassWorkflowTriggerDialog
          open={workflowOpen}
          onOpenChange={setWorkflowOpen}
          recordIds={[recordId]}
        />
      )}
    </div>
  )
}
