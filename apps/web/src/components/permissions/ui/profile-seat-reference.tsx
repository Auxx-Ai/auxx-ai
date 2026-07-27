// apps/web/src/components/permissions/ui/profile-seat-reference.tsx
'use client'

import { PERMISSION_AREAS } from '@auxx/lib/permissions/client'
import { Badge } from '@auxx/ui/components/badge'
import { HardHat, Lock } from 'lucide-react'
import { WORKER_SEAT_AREAS } from './profile-copy'

/**
 * The field-seat ceiling as a **locked reference card** (§0.20).
 *
 * `SEAT_CEILINGS` is a billing invariant, not policy: no org config, group, or
 * personal grant can promote a field seat, and the seat clamp is always the last
 * `min` applied — after this profile's base and after every raise. It is the only
 * cap left in the human model now that the authored profile ceiling is gone
 * (plan 20), and it is a *reference*, never a control. Displayed profile-shaped so
 * it reads in the same
 * vocabulary as the grid above, and it is deliberately **not** a writable copy:
 * storing it per profile is how a billing invariant quietly becomes editable
 * policy.
 */
export function ProfileSeatReference() {
  const open = [...WORKER_SEAT_AREAS].filter((area) => PERMISSION_AREAS[area])

  return (
    <div className='rounded-xl border border-amber-200 bg-amber-50/50 p-4 dark:bg-amber-950/10'>
      <div className='flex items-center gap-2 text-sm font-medium'>
        <HardHat className='size-4 text-amber-600' />
        Field-seat ceiling
        <Badge variant='secondary' size='xs' className='gap-1'>
          <Lock className='size-3' />
          Fixed in code
        </Badge>
      </div>
      <p className='mt-1 text-sm text-muted-foreground'>
        A field seat can only ever reach the areas below, whatever this profile, a group, or a
        personal override says. This clamp is applied last and is not editable here; moving someone
        off it is a seat change, not a profile change.
      </p>
      <div className='mt-3 flex flex-wrap gap-1.5'>
        {open.map((area) => (
          <Badge key={area} variant='secondary' size='xs'>
            {PERMISSION_AREAS[area].label} · Full
          </Badge>
        ))}
        <Badge variant='secondary' size='xs' className='text-muted-foreground'>
          Everything else · None
        </Badge>
      </div>
    </div>
  )
}
