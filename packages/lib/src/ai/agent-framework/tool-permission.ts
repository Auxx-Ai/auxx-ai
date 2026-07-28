// packages/lib/src/ai/agent-framework/tool-permission.ts

import type { ResourcePermission } from '@auxx/database/enums'
import type { InstanceAccessKey } from '../../permissions/capabilities/instance-access'
import type { Area } from '../../permissions/capabilities/registry'

/**
 * String form of the coarse Layer-2 capability {@link Area} enum, so a tool can
 * declare `area: 'agents'` without a *runtime* import of `@auxx/lib/permissions`
 * (this module is type-only on purpose — it must never add an import edge from a
 * tool definition into the permissions barrel, which sits behind the
 * realtime→cache→capabilities cycle). Still checked against the enum: a typo
 * fails to compile.
 */
export type AreaSlug = `${Area}`

/**
 * Whether the requirement declared alongside it is actually asserted by the
 * tool's `execute` **today**.
 *
 * - `'enforced'` — `execute` performs the check before doing the work (or
 *   filters its output by it, which for a list tool is the same boundary).
 * - `'unenforced'` — **KNOWN GAP**. The requirement is real; `execute` does not
 *   check it. This is the greppable marker the audit exists for:
 *   `grep -rn "enforcement: 'unenforced'" packages/lib/src` answers "which agent
 *   tools are unauthorized?" without anyone re-reading a plan document. The
 *   accompanying `note` must say why, and
 *   `capabilities/__tests__/tool-permission-declarations.test.ts` pins the exact
 *   set — adding one, or fixing one without delisting it, fails the suite.
 */
export type AgentToolEnforcement = 'enforced' | 'unenforced'

type EnforcementState =
  | { enforcement: 'enforced'; note?: string }
  | { enforcement: 'unenforced'; note: string }

/**
 * Authorization domains that exist in the product but have **no target in the
 * leveled permission model** (`Area` / entity definition / resource instance).
 * A tool in one of these is not plumbing and must not be declared `'none'`.
 *
 * - `'mail'` — threads, drafts, tags and outbound sending. There is no `mail`
 *   `Area`; visibility is a parallel system (`getCachedUserMailVisibility` +
 *   `getThreadLens`, plans/permissions/v2/05-readside-visibility.md). Note that
 *   every mail tool keys on `agentDeps.userId`, which per doc 14 §0.1 is always
 *   the agent's own engine identity — so run-as substitution and the invoker
 *   intersection are inert for this domain even where `enforcement` is
 *   `'enforced'`.
 * - `'tasks'` — the `Task` table via `TaskService`. Not an entity definition and
 *   not an area; nothing gates it.
 * - `'directory'` — workspace members and groups. `Area.members` exists but is a
 *   Full-only ladder describing *managing* members; there is no read rung for a
 *   directory lookup.
 */
export type UnmodeledPermissionDomain = 'mail' | 'tasks' | 'directory'

/**
 * The authorization contract of one agent tool — what its `execute` must check,
 * and whether it actually does.
 *
 * **This is an audit record, not a runtime gate.** Nothing reads it to decide
 * whether a call proceeds; the server-side assertion inside `execute` is still
 * authoritative (plan 19 §2.4). Its job is to make the tool surface *machine
 * checkable*: `plans/permissions/v2/19b-agent-tool-permission-audit.md` had to
 * hand-sweep 60+ tools to discover that six agent-builder tools had no
 * authorization at all, and that inventory started rotting the next PR. A
 * declaration on the definition rots visibly instead.
 *
 * **Declare what the code does, not what it should do.** `level` on an
 * `'enforced'` declaration names the check `execute` actually performs; on an
 * `'unenforced'` one it names the requirement that is *missing*.
 *
 * **Orthogonal to G0.** Every `'enforced'` declaration describes behavior when
 * `ToolDeps.capabilities` is present. Four runtime paths still pass
 * `capabilities: undefined` deliberately (`workflow-engine/nodes/action-nodes/ai-v2.ts`
 * and the three `approvals/*` runners, each carrying a `KNOWN GAP` comment), and
 * on those paths every capability-backed check below is inert. That is a
 * property of the call site, not of any tool, so it is not repeated per tool.
 */
export type AgentToolPermission =
  /**
   * Per entity **definition** — `canViewEntity` / `canEditEntity` /
   * `canAdministerDef` off `ToolDeps.capabilities`. `level` maps to
   * `view` → `canViewEntity`, `edit` → `canEditEntity`, `admin` →
   * `canAdministerDef` (which has zero tool callers today — 19b G8).
   */
  | (EnforcementState & { target: 'definition'; level: ResourcePermission })
  /**
   * Per shared resource **instance** — `can*Instance(key, id)`. `keys` is a list
   * because one tool may span several instance-access resource types in a single
   * call (`search_knowledge` gates both `kb` and `dataset`).
   */
  | (EnforcementState & {
      target: 'instance'
      keys: readonly InstanceAccessKey[]
      level: ResourcePermission
    })
  /**
   * Coarse Layer-2 **area** — a `PermissionKey` read off the caller's own
   * `CapabilityView` (`getCapabilities(...).can(key)`), expressed as the area +
   * rung that key sits on.
   */
  | (EnforcementState & { target: 'area'; area: AreaSlug; level: ResourcePermission })
  /**
   * A real requirement in a domain the leveled model cannot name — see
   * {@link UnmodeledPermissionDomain}. Deliberately NOT `'none'`: these tools
   * touch workspace data, they just have no `Area` / definition / instance to
   * bind to.
   */
  | (EnforcementState & {
      target: 'unmodeled'
      domain: UnmodeledPermissionDomain
      level: ResourcePermission
    })
  /**
   * An app- or MCP-backed **bridge** tool. Its effects live inside a third-party
   * bundle or an external server, so the platform cannot classify them into a
   * level at all. Authorization is the bridge's own model: install + toolset
   * enablement + `requiresConnection` credential presence + `Agent.appAccounts`
   * binding for apps; `readOnlyHint` + org-set `trusted` + the autonomous-run
   * drop for MCP. Distinct from `'none'` so "unclassifiable" is never confused
   * with "verified to need nothing".
   */
  | { target: 'bridge'; governedBy: 'app' | 'mcp'; note: string }
  /**
   * No authorization required — agent-loop plumbing that writes turn-local state,
   * or a read of genuinely public data. `note` is mandatory: this is the value a
   * careless author would reach for, so it must cost a sentence of justification.
   */
  | { target: 'none'; note: string }

/**
 * Whether a declaration records a known gap — a requirement the tool's `execute`
 * does not actually assert. The one predicate the regression test and any future
 * reporting surface should share.
 */
export function isUnenforcedToolPermission(permission: AgentToolPermission): boolean {
  return 'enforcement' in permission && permission.enforcement === 'unenforced'
}
