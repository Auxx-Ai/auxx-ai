// apps/web/src/components/accounting/ui/provider-sync/provider-sync-schedule-row.tsx

'use client'

// How often the inbound sync runs by itself
// (plans/accounting/tasks/55-the-inbound-sync-runs-in-a-worker.md §5.1).
//
// 🛑 DEFAULT: MANUAL ONLY. 20 §8.3's surviving half is "at close, plus on
// demand, not continuous", and 55 §5.4 holds the cadence back behind two gates
// that have not landed - reversal has never been driven by hand, and a deferral
// still accumulates unseen in a settings blob. A newly connected org gets the
// button, the way a connector defaults `syncBehavior` to `'manual'`.
//
// 🛑 WRITTEN THROUGH `ledger.setProviderSyncSchedule`, not the generic settings
// mutation. Storing the value and registering the BullMQ job scheduler are one
// act; `providerSync.schedule` is router-owned in `setting.ts` so there is no
// second door that writes one without the other.

import { FieldType } from '@auxx/database/enums'
import {
  PROVIDER_SYNC_SCHEDULE_SETTING_KEY,
  type ProviderSyncScheduleConfig,
} from '@auxx/lib/accounting/mirror/client'
import { PermissionKey } from '@auxx/lib/permissions/client'
import { toastError } from '@auxx/ui/components/toast'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanelRow } from '~/components/global/forms/field-panel'
import { useSettings } from '~/hooks/use-settings'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'

/** What the mutation takes. `off` is a cadence switched off, which is not "never set". */
type ScheduleCadence = 'off' | 'twice-daily' | 'daily'

const CHOICES = [
  { value: 'off', label: 'Manual only' },
  { value: 'twice-daily', label: 'Twice a day' },
  { value: 'daily', label: 'Daily' },
]

/** What is stored, read back as a choice. Anything unrecognised reads as manual. */
export function toCadence(value: unknown): ScheduleCadence {
  if (!value || typeof value !== 'object') return 'off'
  const config = value as Partial<ProviderSyncScheduleConfig>
  if (config.triggerInterval !== 'hours') return 'off'
  const hours = Number(config.timeBetweenTriggers?.hours)
  if (hours === 12) return 'twice-daily'
  if (hours === 24) return 'daily'
  return 'off'
}

/** The cadence row on the provider panel. Autosaves; there is no draft to join. */
export function ProviderSyncScheduleRow() {
  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const { can } = useAccess()
  const utils = api.useUtils()
  const setSchedule = api.ledger.setProviderSyncSchedule.useMutation({
    onSuccess: () => utils.setting.getAllUserSettings.invalidate(),
    onError: (error) =>
      toastError({ title: 'Could not change the sync frequency', description: error.message }),
  })

  const cadence = toCadence(getSetting(PROVIDER_SYNC_SCHEDULE_SETTING_KEY))

  return (
    <FieldPanelRow
      title='Sync frequency'
      description='How often the ledger is read without anybody pressing anything. Manual only is the default - the first runs against a real company file want a person watching them.'>
      <FieldInputAdapter
        fieldType={FieldType.SINGLE_SELECT}
        fieldOptions={{ options: CHOICES }}
        triggerProps={{ className: 'w-full ps-0 pe-1' }}
        value={[cadence]}
        // 🛑 `ledgerControl`, the rung the press itself takes: a cadence decides
        // when prior months get restated with nobody watching.
        disabled={!can(PermissionKey.ledgerControl) || setSchedule.isPending}
        onChange={(next) => {
          const picked = (Array.isArray(next) ? next[0] : next) as ScheduleCadence | undefined
          setSchedule.mutate({ cadence: picked ?? 'off' })
        }}
      />
    </FieldPanelRow>
  )
}
