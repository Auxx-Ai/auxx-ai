// apps/web/src/components/accounting/ui/settings/setup-status-section.tsx
'use client'

// Setup state, the readiness list, and Finalize (13-accounting-ui.md §3.4).
//
// 🛑 `accounting.setupState` is rendered as STATUS, never as an editable select.
// It moves by action: finalizing is an assertion about the books, not a value
// somebody picks off a dropdown. The catalog does declare it as a
// SINGLE_SELECT, and that is exactly the shape this screen must not expose.
//
// 🛑 Readiness comes from the shared pure predicate `resolveSetupReadiness`
// over the settings record, not from a query. One authority, two callers: this
// page client-side over hydrated `useSettings`, and `signals.ts` server-side
// over cached settings for the checklist widget. Writing the arithmetic twice
// is what would rot.

import type { SetupReadiness } from '@auxx/lib/postings/client'
import { toActorId } from '@auxx/types/actor'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { format, parseISO } from 'date-fns'
import { AlertTriangle, ArrowRight, Check, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { SettingsSection } from '~/components/global/settings-page'
import { useActor } from '~/components/resources/hooks'
import { BaseType } from '~/components/workflow/types'
import { READINESS_LINKS } from './accounting-settings-keys'

interface SetupStatusSectionProps {
  readiness: SetupReadiness
  /** `accounting.setupFinalizedAt`, ISO 8601. */
  finalizedAt: string | null
  /** `accounting.setupFinalizedByUserId`. */
  finalizedByUserId: string | null
  /** True while any section on this page holds unsaved edits. */
  hasUnsavedChanges: boolean
  isFinalizing: boolean
  onFinalize: () => void
}

export function SetupStatusSection({
  readiness,
  finalizedAt,
  finalizedByUserId,
  hasUnsavedChanges,
  isFinalizing,
  onFinalize,
}: SetupStatusSectionProps) {
  const { finalized, requirements, settingsReady } = readiness

  // Batched through the actor store, so naming the person who finalized costs
  // no dedicated query.
  const { actor } = useActor({
    actorId: finalizedByUserId ? toActorId('user', finalizedByUserId) : null,
  })

  const blockedReason = finalized
    ? undefined
    : hasUnsavedChanges
      ? 'Save your changes first. Readiness is computed from saved settings, so a dirty ' +
        'form and this list would disagree.'
      : !settingsReady
        ? 'Every requirement below has to be met first.'
        : undefined

  return (
    <SettingsSection
      icon={ShieldCheck}
      title='Setup status'
      description='Finalizing freezes the opening baseline. Nothing may post until it is finalized.'>
      <FieldPanel className='mt-1 p-0' resizeId='accounting-setup-status' defaultLabelWidth={220}>
        <FieldPanelRow
          title='State'
          type={BaseType.ENUM}
          showIcon
          description='Moves by action, not by picking a value. Finalize below is the only way in.'>
          <div className='flex min-h-8 flex-wrap items-center gap-2'>
            <Badge variant={finalized ? 'green' : 'amber'} size='sm'>
              {finalized ? 'Finalized' : 'Draft'}
            </Badge>
            <span className='text-muted-foreground text-xs'>
              {finalized
                ? 'Postings are permitted.'
                : 'Every posting path refuses while this reads draft.'}
            </span>
          </div>
        </FieldPanelRow>

        {finalized && (
          <FieldPanelRow
            title='Finalized'
            type={BaseType.DATETIME}
            showIcon
            description='Stamped when Finalize was pressed. Provenance, not an editable field.'>
            <div className='flex min-h-8 items-center text-sm'>
              {finalizedAt ? (
                format(parseISO(finalizedAt), 'PPp')
              ) : (
                <span className='text-muted-foreground'>Not recorded</span>
              )}
            </div>
          </FieldPanelRow>
        )}

        {finalized && (
          <FieldPanelRow
            title='Finalized by'
            type={BaseType.ACTOR}
            showIcon
            description='Provenance, not an editable field.'>
            <div className='flex min-h-8 items-center text-sm'>
              {finalizedByUserId ? (
                (actor?.name ?? finalizedByUserId)
              ) : (
                <span className='text-muted-foreground'>Not recorded</span>
              )}
            </div>
          </FieldPanelRow>
        )}
      </FieldPanel>

      <div className='space-y-3 rounded-xl border p-3'>
        <p className='font-medium text-sm'>Requirements</p>

        <ul className='space-y-2'>
          {requirements.map((requirement) => {
            const link = READINESS_LINKS[requirement.key]
            return (
              <li key={requirement.key} className='flex items-start gap-2 text-sm'>
                {requirement.met ? (
                  <Check className='mt-0.5 size-4 shrink-0 text-green-600' />
                ) : (
                  <AlertTriangle className='mt-0.5 size-4 shrink-0 text-amber-600' />
                )}
                <div className='min-w-0 space-y-0.5'>
                  <p className={requirement.met ? 'text-muted-foreground' : undefined}>
                    {link?.label ?? requirement.key}
                  </p>
                  {!requirement.met && requirement.reason && (
                    <p className='text-muted-foreground text-xs'>{requirement.reason}</p>
                  )}
                  {!requirement.met && link && (
                    <Link
                      href={link.href}
                      className='inline-flex items-center gap-1 text-primary-600 text-xs hover:underline'>
                      Fix this <ArrowRight className='size-3' />
                    </Link>
                  )}
                </div>
              </li>
            )
          })}
        </ul>

        {/*
          The list is settings-derived and complete for what it claims. Three
          more requirements are facts about ROWS rather than settings and are
          deliberately absent from the predicate: the standard-cost roll (part
          rows), the account role map (`GlRoleAssignment` rows), and whether a
          first entry is posted (`GlPosting` rows). Each belongs to a page that
          already loads them. Saying so beats a list that silently under-reports.
        */}
        <p className='text-muted-foreground text-xs'>
          Two more things have to be true before a month can close, and neither is a setting: every
          part carries a standard cost (roll it below), and every account role is mapped on{' '}
          <Link href='/app/accounting/settings/accounts' className='hover:underline'>
            Accounts
          </Link>
          . A preview refuses by naming the specific row, which is something no checklist can do.
        </p>

        <div className='flex flex-wrap items-center justify-end gap-3 border-t pt-3'>
          {blockedReason && (
            <span className='mr-auto text-muted-foreground text-xs'>{blockedReason}</span>
          )}
          {finalized && (
            <span className='mr-auto text-muted-foreground text-xs'>
              Already finalized. Correcting the baseline now goes through reversal and re-entry,
              never an edit to setup history.
            </span>
          )}
          <Button
            variant='outline'
            size='sm'
            loading={isFinalizing}
            loadingText='Finalizing...'
            disabled={finalized || !settingsReady || hasUnsavedChanges || isFinalizing}
            onClick={onFinalize}>
            Finalize setup
          </Button>
        </div>
      </div>
    </SettingsSection>
  )
}
