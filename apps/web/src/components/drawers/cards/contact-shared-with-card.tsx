// apps/web/src/components/drawers/cards/contact-shared-with-card.tsx
'use client'

import { toRecordId } from '@auxx/types/resource'
import { useState } from 'react'
import { useMailShare } from '~/components/mail-permissions/hooks/use-mail-share'
import { AccessLevelsGuide } from '~/components/mail-permissions/ui/access-levels-guide'
import { EnterpriseGate } from '~/components/mail-permissions/ui/enterprise-gate'
import { MailGranteeList } from '~/components/mail-permissions/ui/mail-grantee-list'
import { useUser } from '~/hooks/use-user'
import type { DrawerTabProps } from '../drawer-tab-registry'

/**
 * ContactSharedWithCard — mail-permissions contact sharing (UI plan §4).
 * People here can see ALL conversations this contact participates in — the
 * widest blast radius in the visibility model, hence the load-bearing copy.
 * Admin-managed (matching the server rule); other roles see a read-only list
 * only when shares already exist.
 */
export function ContactSharedWithCard({ entityInstanceId }: DrawerTabProps) {
  const { isAdminOrOwner } = useUser()
  const [guideOpen, setGuideOpen] = useState(false)

  // ResourceAccess keys contact grants by the fixed 'contact' slug.
  const shareRecordId = toRecordId('contact', entityInstanceId)
  const { grants, unmanageableGrants, grant, changeLens, revoke } = useMailShare({
    recordId: shareRecordId,
  })

  // A grant on a kind this list can't address still means the contact IS shared.
  if (!isAdminOrOwner && grants.length === 0 && unmanageableGrants.length === 0) return null

  return (
    <div className='space-y-2'>
      <p className='text-muted-foreground text-xs'>
        People here can see <span className='font-medium'>all conversations</span> this contact
        participates in.
      </p>
      <EnterpriseGate className='w-full'>
        <MailGranteeList
          grants={grants}
          onGrant={grant}
          onChangeLens={changeLens}
          onRevoke={revoke}
          disabled={!isAdminOrOwner}
          unmanageableGrants={unmanageableGrants}
          emptyHint='Not shared. Only inbox members see these conversations.'
          stagedAdd
        />
      </EnterpriseGate>
      <button
        type='button'
        className='text-muted-foreground text-xs underline-offset-2 hover:underline'
        onClick={() => setGuideOpen(true)}>
        Learn about access levels
      </button>
      <AccessLevelsGuide open={guideOpen} onOpenChange={setGuideOpen} />
    </div>
  )
}
