// apps/web/src/components/permissions/hooks/use-instance-share-copy.ts
'use client'

import { isMailSharingDef } from '@auxx/lib/resource-access/mail-sharing-defs'
import type { RecordId } from '@auxx/types/resource'
import { parseRecordId } from '@auxx/types/resource'
import { useMemo } from 'react'
import { useRecordAccess } from '~/components/resources/hooks'
import { useResource } from '~/components/resources/hooks/use-resource'
import { useCanAdminInstance } from '~/providers/capabilities-provider'
import {
  INSTANCE_SHARE_COPY,
  type InstanceShareCopy,
  recordShareCopy,
} from '../ui/instance-share-copy'

/**
 * Resolve the share-card copy for ANY shareable target — the seam that lets one
 * dialog serve both sharing lanes (plan v3/03 §6.3).
 *
 * Two sources, in this order:
 *  1. {@link INSTANCE_SHARE_COPY} — the nine hand-authored config-scale entries.
 *  2. a **record-definition fallback** built from the def's singular name.
 *
 * Returns `null` for anything neither source covers, which is what the card /
 * body render as nothing. Two exclusions are deliberate:
 *
 *  - **Mail sharing defs** (`thread`, `contact`). They have their own share
 *    family (`mail-permissions/ui/`), a different ladder, and — for `contact` —
 *    a live keyspace hazard: a CUID-keyed contact grant canonicalizes into the
 *    MAIL keyspace and fans a lens across that contact's whole conversation
 *    history (§10.1). Records stay out of that keyspace entirely.
 *  - **A def the resource store has not hydrated.** Better no dialog than one
 *    titled "Share item".
 */
export function useInstanceShareCopy(
  recordId: RecordId | null | undefined
): InstanceShareCopy | null {
  const key = recordId ? parseRecordId(recordId).entityDefinitionId : ''
  const instanceCopy =
    key && key in INSTANCE_SHARE_COPY
      ? INSTANCE_SHARE_COPY[key as keyof typeof INSTANCE_SHARE_COPY]
      : undefined
  // Called unconditionally (hook rules); resolves to `undefined` for the
  // instance lane, which never reaches the record branch below anyway.
  const { resource } = useResource(instanceCopy || !key ? null : key)

  return useMemo(() => {
    if (instanceCopy) return instanceCopy
    if (!key || isMailSharingDef(key)) return null
    if (!resource) return null
    return recordShareCopy(resource.label)
  }, [instanceCopy, key, resource])
}

/**
 * "May the current member manage THIS target's sharing?" — the client mirror of
 * the server's `authorizeInstanceTarget`, which is itself two lanes:
 *
 *  - instance-access resources → `canAdminInstance(key, instanceId)`;
 *  - record defs → row-effective rung ≥ `admin`
 *    (`assertCanManageRecordSharing`). `_access` has already folded the def
 *    level in, so there is no separate def branch — base record rungs cap at
 *    `edit`, so `admin` can only come from an explicit grant or OWNER.
 *
 * Both underlying hooks run unconditionally; only one answer is used.
 */
export function useCanManageInstanceSharing(recordId: RecordId | null | undefined): boolean {
  const key = recordId ? parseRecordId(recordId).entityDefinitionId : ''
  const isInstanceLane = Boolean(key) && key in INSTANCE_SHARE_COPY
  // `canAdminInstance` narrows out every non-registry key, so a record CUID (or
  // the no-target sentinel) answers `false` without a branch here.
  const canAdminInstance = useCanAdminInstance((recordId ?? 'none:none') as RecordId)
  const { canShare } = useRecordAccess(isInstanceLane ? null : recordId)
  return isInstanceLane ? canAdminInstance : canShare
}
