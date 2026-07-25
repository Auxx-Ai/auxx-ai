// apps/web/src/server/api/grantee-schema.ts

import { ResourceGranteeType } from '@auxx/database/enums'
import { getCachedPermissionProfiles } from '@auxx/lib/cache'
import { BadRequestError } from '@auxx/lib/errors'
import { z } from 'zod'

/**
 * The grantee vocabulary a `ResourceAccess` write endpoint accepts — ONE schema
 * shared by every sharing router, instead of the eight divergent copies the tree
 * used to carry (doc 19 §8.2 and `19a` sites 15 + 17; the copy nobody had noticed
 * sat on `resourceAccess.setType`, which the whole def-Access UI writes through).
 *
 * `profile` is included. Doc 19 §0.1 keeps human per-def and shared per-instance
 * grants as `ResourceAccess` rows, and §0.28 makes the profile selectable as an
 * additive grantee. This is deliberately the FULL `ResourceGranteeType` and not
 * `SharingGranteeType`: that narrower union exists so surfaces which *cannot*
 * resolve a profile never hand one to a router — these routers now can.
 *
 * Writes still fail downstream until `resource-access-service.ts` drops its
 * step-9 profile guard. That ordering is intentional, not a bug.
 */
export const granteeTypeSchema = z.enum([
  ResourceGranteeType.group,
  ResourceGranteeType.user,
  ResourceGranteeType.team,
  ResourceGranteeType.role,
  ResourceGranteeType.profile,
])

/**
 * Reject a `profile` grantee that cannot actually carry a sharing grant.
 *
 * Two failure modes, both silent without this check:
 * - **Unknown id** — a row keyed on a profile that does not exist grants nobody,
 *   yet still flips the def/instance into the grantee-agnostic *restricted* set
 *   (`19a` finding 1), so it takes access away instead of adding it.
 * - **An agent profile** (`appliesTo: 'agent'`) — agents resolve capabilities from
 *   `AgentVersion.permissionPolicy` through `AgentPolicyCapabilities` and never
 *   read `ResourceAccess` (doc 19 §0.1, §2.3). Such a row is inert: a control that
 *   looks like it works and does nothing. Agent authority is authored on the
 *   profile's own `agentPolicy`, never through a sharing router.
 *
 * Reads and revokes deliberately skip this — a row left behind by a deleted or
 * repurposed profile must stay listable and cleanable.
 *
 * Costs nothing for the non-profile kinds (early return) and one org-cache hit
 * otherwise; `profiles` is already cached for capability composition (§8.1).
 */
export async function assertProfileGranteesAuthorable(
  organizationId: string,
  granteeType: ResourceGranteeType,
  granteeIds: string[]
): Promise<void> {
  if (granteeType !== ResourceGranteeType.profile || granteeIds.length === 0) return
  const profiles = await getCachedPermissionProfiles(organizationId)
  for (const granteeId of granteeIds) {
    const profile = profiles.find((p) => p.id === granteeId)
    if (!profile) {
      throw new BadRequestError('Permission profile not found')
    }
    if (profile.appliesTo === 'agent') {
      throw new BadRequestError(
        `"${profile.name}" is an agent profile. Agent access is authored on the profile itself, not by sharing a resource with it.`
      )
    }
  }
}
