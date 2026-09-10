// apps/web/src/server/lib/instance-access-def-guard.ts
//
// The generic record path's refusal of instance-access defs, shared by `record.ts`
// (every arm) and `data-connectors.ts` (the write arm, for `archiveRemovedUpstream`).
// One implementation so the two doors cannot drift.

import { getCachedResources } from '@auxx/lib/cache'
import { ForbiddenError } from '@auxx/lib/errors'
import { type InstanceAccessKey, isInstanceAccessKey } from '@auxx/lib/permissions'

/**
 * The §3 closure: the generic record path REFUSES instance-access defs.
 *
 * Signatures are `EntityInstance` rows on the `signature` def, so before plan 36
 * they were read and mutated straight through `record.*` — whose only asserts
 * are three `recordsDelete` calls and whose def-level gate returned `true`
 * unconditionally for `signature` via `isMailInfraDef`. Minting
 * `signature.ts` alone would therefore have closed nothing: a member could still
 * enumerate, read, mutate and delete every signature in the org here. So this
 * path stops resolving them at all, and `signature.ts` becomes the only door.
 *
 * **Audit of what else this touches (re-verified 2026-07-29).** `dataset`, `kb`,
 * `dashboard`, `workflow` and `snippet` are first-class tables served by their
 * own routers and have no entry in `seed/entity-seeder/constants.ts` at all;
 * `article` IS a seeded def but is not an instance-access key (it inherits its
 * KB's grants, and its data lives in the `Article` table). The
 * `EntityDefinition`-backed keys are `signature` — the subject this guard was
 * built for — and, since plan 40 phase 1, the two MAIL keys, which are the
 * reason this function now has two arms.
 *
 * **THE MAIL EXEMPTION (plan 40 §8.1 / 40a §8.1, decision (a)).** `inbox` and
 * `personal_inbox` joined `INSTANCE_ACCESS_RESOURCES` in phase 1, and a blanket
 * refusal would have broken the mail sidebar, the inbox pickers and the thread
 * inbox column in the phase that is supposed to be INERT. So:
 *
 *  - {@link assertNotInstanceAccessDefForWrite} — every MUTATION on this router.
 *    Unchanged behaviour: the mail keys are refused here like every other one.
 *    That also satisfies 40a §8.4 for free — the generic create path must not
 *    accept `personal_inbox`, because personal inboxes are created ONLY through
 *    provisioning.
 *  - {@link assertNotInstanceAccessDefForRead} — every QUERY. The mail keys pass.
 *  - {@link assertNotInstanceAccessDefForSearch} — {@link search} only, which
 *    additionally admits `kb` and `dataset` now that its path narrows per row.
 *    See {@link SEARCH_EXEMPT_KEYS} for why that is one procedure wide.
 *
 * **Why the read exemption is safe, and why it is not the leak it looks like:**
 * the records capability layer was never the access authority for an inbox.
 * Mail visibility is — `userInstanceGrants` (the per-inbox lens floor, composed
 * from `ResourceAccess` rows — the `role:org_member` baseline plus the
 * `Area.inboxes` fallback) and the mail-grant index —
 * and `UnifiedCrudHandler`'s def-level `canViewEntity('inbox')` short-circuits
 * to `true` via `isMailInfraDef` regardless of what this guard does. Refusing
 * the read arm would therefore have closed nothing that was open; it would only
 * have broken the readers. Contrast `signature`, which this guard genuinely
 * closes: `signature.ts` IS its only door, and it left `NON_RECORD_DEF_SLUGS`
 * precisely so no def-level pass-through survives.
 *
 * The mutation arm keeps its teeth for the same reason it has them elsewhere:
 * inbox WRITES answer to `channels.manage` + `assertAdminInstance` in
 * `inbox.ts`, and a second door into `EntityInstance` updates would route around
 * both.
 *
 * `ForbiddenError` rather than `BadRequestError` because it fails closed and
 * reads correctly to anything probing for data. It denies OWNER too — that is
 * intended: "one access authority per resource" is a routing invariant, not a
 * permission the caller can hold.
 */
async function assertNotInstanceAccessDef(
  organizationId: string,
  identifiers: Array<string | null | undefined>,
  exempt: ReadonlySet<InstanceAccessKey>
): Promise<void> {
  const candidates = identifiers.filter((v): v is string => typeof v === 'string' && v.length > 0)
  if (candidates.length === 0) return

  // The bare slug form ('signature') short-circuits without touching the cache;
  // everything else has to be resolved, because the client may just as well send
  // the def UUID or the apiSlug.
  const unresolved: string[] = []
  for (const candidate of candidates) {
    if (isInstanceAccessKey(candidate)) {
      if (!exempt.has(candidate)) throw instanceAccessDefError(candidate)
      continue
    }
    unresolved.push(candidate)
  }

  const resources = await getCachedResources(organizationId)
  for (const candidate of unresolved) {
    const resource = resources.find(
      (r) => r.id === candidate || r.entityDefinitionId === candidate || r.apiSlug === candidate
    )
    const entityType = resource?.entityType
    if (entityType && isInstanceAccessKey(entityType) && !exempt.has(entityType)) {
      throw instanceAccessDefError(entityType)
    }
  }
}

/**
 * The mail keys, exempted on the READ arm only — see
 * {@link assertNotInstanceAccessDef}. Explicit rather than derived from
 * `baselineAtCreate` or an area: this is a ROUTING carve-out for two named defs,
 * and a derived form would silently widen the moment another resource happened
 * to share the shape.
 */
export const MAIL_READ_EXEMPT_KEYS: ReadonlySet<InstanceAccessKey> = new Set<InstanceAccessKey>([
  'inbox',
  'personal_inbox',
])

/**
 * The keys {@link search} admits — the mail carve-out plus `kb` and `dataset`.
 *
 * **A carve-out on ONE procedure, not on the read arm**, for the same reason
 * {@link HYDRATION_EXEMPT_KEYS} is one procedure wide: an exemption is only as
 * defensible as the gate standing behind that specific path, and the paths
 * differ. `search` is scoped; `getById`, `listAll` and `listFiltered` are not
 * this pair's doors and stay refused.
 *
 * **Why `kb` and `dataset` may pass here now.** The original refusal was never
 * "these resources are off-limits" — it was that `getResources` had no
 * instance-access predicate, so admitting them would have handed any member the
 * org's whole KB list. `HYDRATION_EXEMPT_KEYS` already made exactly that
 * argument and unblocked `getByIds` alone, on the strength of the picker's
 * post-fetch `admitSystemRows`.
 *
 * That asymmetry was itself a bug, and a widely-felt one: a member could see the
 * KBs already attached to an agent (hydration) but could not add another
 * (search). Every kb/dataset picker in the app rides this procedure — the agent
 * Knowledge tab, the chat-widget AI settings, the dataset node, the
 * knowledge-retrieval node — and all of them returned nothing.
 *
 * A post-fetch filter could not fix it: on a paginated path it shorts the page
 * and desyncs the cursor. What closes it is `instanceTableVisibilityScope`,
 * which renders the same composed blob as an id predicate applied BEFORE
 * `LIMIT`, reached through `systemTableVisibilityScope` — plus the matching
 * viewer dimension in the picker's result cache key, without which an org-keyed
 * cache would hand one member's page to another.
 *
 * 🔴 **The WRITE arm is unchanged and must stay that way.** `kb.ts` and
 * `dataset.ts` are the only doors for mutation; a second one into
 * `EntityInstance` updates would route around their asserts.
 *
 * Everything else — `dashboard`, `workflow`, `agent`, `signature`, `snippet` —
 * stays refused everywhere. They are not statically pickable, so there is no
 * system-table path for a scope to gate in the first place.
 */
export const SEARCH_EXEMPT_KEYS: ReadonlySet<InstanceAccessKey> = new Set<InstanceAccessKey>([
  ...MAIL_READ_EXEMPT_KEYS,
  'kb',
  'dataset',
])

const NO_EXEMPT_KEYS: ReadonlySet<InstanceAccessKey> = new Set<InstanceAccessKey>()

/** Refuse EVERY instance-access def — the mutation arm. */
export function assertNotInstanceAccessDefForWrite(
  organizationId: string,
  identifiers: Array<string | null | undefined>
): Promise<void> {
  return assertNotInstanceAccessDef(organizationId, identifiers, NO_EXEMPT_KEYS)
}

/** Refuse every instance-access def EXCEPT the mail keys — the query arm. */
export function assertNotInstanceAccessDefForRead(
  organizationId: string,
  identifiers: Array<string | null | undefined>
): Promise<void> {
  return assertNotInstanceAccessDef(organizationId, identifiers, MAIL_READ_EXEMPT_KEYS)
}

/** {@link assertNotInstanceAccessDefForRead}, widened for {@link search} alone. */
export function assertNotInstanceAccessDefForSearch(
  organizationId: string,
  identifiers: Array<string | null | undefined>
): Promise<void> {
  return assertNotInstanceAccessDef(organizationId, identifiers, SEARCH_EXEMPT_KEYS)
}

function instanceAccessDefError(key: string): ForbiddenError {
  return new ForbiddenError(
    `"${key}" is not reachable through the generic record path — use its own router.`
  )
}
