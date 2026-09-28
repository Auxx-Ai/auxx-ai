// apps/web/src/components/data-connectors/hooks/use-can-manage-connectors.ts
'use client'

import { FeatureKey, PermissionKey } from '@auxx/lib/permissions/client'
import { useAccess } from '~/providers/capabilities-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'

/** True when the plan has data connectors and the member holds `connectors.manage` — the connectors page's own gates. */
export function useCanManageConnectors(): boolean {
  const { hasAccess } = useFeatureFlags()
  const { can } = useAccess()
  return hasAccess(FeatureKey.dataConnectors) && can(PermissionKey.connectorsManage)
}
