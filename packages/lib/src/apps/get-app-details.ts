// packages/lib/src/apps/get-app-details.ts

import type { CatalogPayload, Database } from '@auxx/database'
import {
  type ConnectionDefinitionSummary,
  type ConnectionMethod,
  getAppConnectionDefinition,
  listAppConnectionDefinitions,
} from '@auxx/services/app-connections'
import { getCachedAppBySlug } from '../cache/app-cache-helpers'
import {
  gateConnectionVariables,
  resolveOwnClientRequirement,
} from '../connections/resolve-connection-definition'

/**
 * Input parameters for getAppWithInstallationStatus
 */
export interface GetAppWithStatusInput {
  appSlug: string
  organizationId: string
  db: Database
}

/**
 * One capability category for the About-page "Includes" badges. `names` is capped
 * (see NAME_CAP) for payload size; `count` is the true total so the badge can show
 * "+N more" beyond the listed names.
 */
export interface CapabilityGroup {
  count: number
  names: string[]
}

/**
 * Compact, client-safe summary of what an app's latest deployment defines.
 * Computed from `AppDeployment.catalog` — no server-only catalog types cross the wire.
 */
export interface AppCapabilitySummary {
  tools: CapabilityGroup
  quickActions: CapabilityGroup
  /** Workflow blocks + workflow triggers, combined. */
  workflowBlocks: CapabilityGroup
  dataConnectors: CapabilityGroup
  /** Derived connection descriptor, or null when the app needs no connection. */
  connection: { label: string } | null
}

/**
 * Own-client gate flags (§3.1) attached to every method/definition the connect UI renders.
 * `@auxx/services` can't import `@auxx/lib` (tier rule), so the gate is computed here —
 * mirroring the installed-apps cache provider so both read paths agree.
 */
export interface OwnClientGate {
  /** BYO client id/secret are mandatory (def has no platform client). */
  requiresOwnClient: boolean
  /** Platform client pending verification — BYO offered as an optional alternative. */
  ownClientOptional: boolean
  ownClientReason: 'no-platform-client' | 'pending-approval' | null
}

export type GatedConnectionMethod = ConnectionMethod & OwnClientGate
export type GatedConnectionDefinitionSummary = ConnectionDefinitionSummary & OwnClientGate

/**
 * App details with installation status
 */
export interface AppWithStatusOutput {
  app: {
    id: string
    slug: string
    title: string
    description: string | null
    avatarUrl: string | null
    category: string | null
    websiteUrl: string | null
    documentationUrl: string | null
    supportSiteUrl: string | null
    overview: string | null
    contentOverview: string | null
    contentHowItWorks: string | null
    contentConfigure: string | null
    scopes: string[]
    hasOauth: boolean
    hasBundle: boolean
    screenshots: string[]
    verified: boolean
    publicationStatus: string
  }
  developerAccount: {
    title: string
    logoUrl: string | null
  }
  installation: {
    id: string | undefined
    isInstalled: boolean
    installationType?: 'development' | 'production'
    installedAt?: Date
    currentDeploymentId?: string
    // Every connection method the app exposes — the connect picker appears when length > 1.
    methods: GatedConnectionMethod[]
    // Derived two-slot view (first method per scope) kept for presence/scope consumers.
    connectionDefinitions: {
      user?: GatedConnectionDefinitionSummary
      organization?: GatedConnectionDefinitionSummary
    }
  }
  availableDeployments: Array<{
    id: string
    version: string | null
    deploymentType: 'development' | 'production'
    status: string
    createdAt: Date
  }>
  /** What the latest deployment defines — surfaced as "Includes" badges on the About page. */
  capabilities: AppCapabilitySummary
}

/**
 * Get detailed app information with installation status for an organization.
 * Uses the global app slug cache for app data, DB for org-scoped parts.
 */
export async function getAppWithInstallationStatus(
  input: GetAppWithStatusInput
): Promise<
  | { ok: true; value: AppWithStatusOutput }
  | { ok: false; error: { code: string; message: string; [key: string]: unknown } }
> {
  const { appSlug, organizationId, db } = input

  // Resolve app from cache
  const cachedApp = await getCachedAppBySlug(appSlug)

  if (!cachedApp) {
    return {
      ok: false,
      error: { code: 'APP_NOT_FOUND', message: `App "${appSlug}" not found`, appSlug },
    }
  }

  // Query deployments accessible to this org
  const deployments = await db.query.AppDeployment.findMany({
    where: (d, { or, and, eq }) =>
      and(
        eq(d.appId, cachedApp.id),
        or(
          and(eq(d.deploymentType, 'development'), eq(d.targetOrganizationId, organizationId)),
          and(eq(d.deploymentType, 'production'), eq(d.status, 'published'))
        )
      ),
    orderBy: (d, { desc }) => [desc(d.createdAt)],
  })

  // Query installation status
  const installation = await db.query.AppInstallation.findFirst({
    where: (inst, { and, eq, isNull }) =>
      and(
        eq(inst.organizationId, organizationId),
        eq(inst.appId, cachedApp.id),
        isNull(inst.uninstalledAt)
      ),
  })

  // Access check
  const hasDevDeployments = deployments.some(
    (d) => d.deploymentType === 'development' && d.targetOrganizationId === organizationId
  )
  const isPublished = cachedApp.publicationStatus === 'published'
  const hasActiveInstallation = !!installation

  if (!isPublished && !hasDevDeployments && !hasActiveInstallation) {
    return {
      ok: false,
      error: {
        code: 'APP_ACCESS_DENIED',
        message: `You do not have access to app "${appSlug}"`,
        appSlug,
        organizationId,
      },
    }
  }

  // Fetch developer account info for display
  const developerAccount = await db.query.DeveloperAccount.findFirst({
    where: (da, { eq }) => eq(da.id, cachedApp.developerAccountId),
    columns: { title: true, logoUrl: true },
  })

  // Connection methods are app-keyed (not installation-scoped), so fetch them regardless of
  // installation — the About page needs them to derive the connection badge for not-yet-installed
  // apps. The per-scope two-slot view stays installed-only (only meaningful once connected).
  const connectionDefinitions: AppWithStatusOutput['installation']['connectionDefinitions'] = {}
  const methodsResult = await listAppConnectionDefinitions(cachedApp.id)
  const rawMethods: ConnectionMethod[] = methodsResult.isOk() ? methodsResult.value : []

  // Own-client gate (§3.1): fetch the client/approval columns the services listing omits and
  // shape each method's variables (inject/require/drop the BYO client fields). Without this,
  // a pending-approval OAuth method with no declared variables connects one-click and the
  // user never sees the platform-or-BYO choice.
  const gateRows = rawMethods.length
    ? await db.query.ConnectionDefinition.findMany({
        where: (d, { inArray }) =>
          inArray(
            d.id,
            rawMethods.map((m) => m.id)
          ),
        columns: {
          id: true,
          global: true,
          oauth2ClientId: true,
          oauth2ClientSecret: true,
          platformClientApproved: true,
        },
      })
    : []
  const gateRowById = new Map(gateRows.map((r) => [r.id, r]))
  const NO_GATE: OwnClientGate = {
    requiresOwnClient: false,
    ownClientOptional: false,
    ownClientReason: null,
  }
  const gateFor = (row: (typeof gateRows)[number] | undefined, connectionType: string) => {
    if (!row || connectionType !== 'oauth2-code') return NO_GATE
    const gate = resolveOwnClientRequirement(row)
    return {
      requiresOwnClient: gate.requiresOwnClient,
      ownClientOptional: gate.ownClientOptional,
      ownClientReason: gate.reason,
    }
  }

  const methods: GatedConnectionMethod[] = rawMethods.map((m) => {
    const gate = gateFor(gateRowById.get(m.id), m.connectionType)
    return {
      ...m,
      ...gate,
      connectionVariables: gateConnectionVariables(m.connectionType, m.connectionVariables, gate),
    }
  })

  if (installation) {
    const [userConnDef, orgConnDef] = await Promise.all([
      getAppConnectionDefinition(cachedApp.id, false),
      getAppConnectionDefinition(cachedApp.id, true),
    ])
    // The two-slot summaries carry no row id — match their gate row by scope. (`findFirst`
    // per scope and this `find` can only disagree when an app has >1 method in one scope,
    // which no app does today; the flow resolves by method id in that case anyway.)
    const gateForScope = (global: boolean, connectionType: string) =>
      gateFor(
        gateRows.find((r) => r.global === global),
        connectionType
      )
    if (userConnDef.isOk() && userConnDef.value) {
      const def = userConnDef.value
      const gate = gateForScope(false, def.connectionType)
      connectionDefinitions.user = {
        ...def,
        ...gate,
        connectionVariables: gateConnectionVariables(
          def.connectionType,
          def.connectionVariables ?? [],
          gate
        ),
      }
    }
    if (orgConnDef.isOk() && orgConnDef.value) {
      const def = orgConnDef.value
      const gate = gateForScope(true, def.connectionType)
      connectionDefinitions.organization = {
        ...def,
        ...gate,
        connectionVariables: gateConnectionVariables(
          def.connectionType,
          def.connectionVariables ?? [],
          gate
        ),
      }
    }
  }

  // Summarize the latest accessible deployment's catalog into client-safe count + name groups.
  const capabilities = summarizeCapabilities(
    deployments[0]?.catalog ?? null,
    methods,
    cachedApp.hasOauth
  )

  return {
    ok: true,
    value: {
      app: {
        id: cachedApp.id,
        slug: cachedApp.slug,
        title: cachedApp.title,
        description: cachedApp.description,
        avatarUrl: cachedApp.avatarUrl,
        category: cachedApp.category,
        websiteUrl: cachedApp.websiteUrl,
        documentationUrl: cachedApp.documentationUrl,
        supportSiteUrl: cachedApp.supportSiteUrl,
        overview: cachedApp.overview,
        contentOverview: cachedApp.contentOverview,
        contentHowItWorks: cachedApp.contentHowItWorks,
        contentConfigure: cachedApp.contentConfigure,
        scopes: cachedApp.scopes,
        hasOauth: cachedApp.hasOauth,
        hasBundle: cachedApp.hasBundle,
        screenshots: cachedApp.screenshots,
        verified: cachedApp.verified,
        publicationStatus: cachedApp.publicationStatus,
      },
      developerAccount: developerAccount
        ? { title: developerAccount.title, logoUrl: developerAccount.logoUrl }
        : { title: 'Unknown', logoUrl: null },
      installation: {
        id: installation?.id,
        isInstalled: !!installation,
        installationType: installation?.installationType as
          | 'development'
          | 'production'
          | undefined,
        installedAt: installation?.installedAt,
        currentDeploymentId: installation?.currentDeploymentId ?? undefined,
        methods,
        connectionDefinitions,
      },
      availableDeployments: deployments.map((d) => ({
        id: d.id,
        version: d.version,
        deploymentType: d.deploymentType as 'development' | 'production',
        status: d.status,
        createdAt: d.createdAt,
      })),
      capabilities,
    },
  }
}

/** Max item names projected per category — the tooltip shows "+N more" beyond this. */
const CAPABILITY_NAME_CAP = 20

/** Build a {count, names} group, capping the names list while keeping the true total. */
function toCapabilityGroup(names: string[]): CapabilityGroup {
  return { count: names.length, names: names.slice(0, CAPABILITY_NAME_CAP) }
}

/**
 * Project the latest deployment's catalog into a compact, client-safe summary.
 * Defensive against null catalogs (bundle-less apps) and optional catalog keys
 * (`workflow`, `dataConnectors`) that older catalogs omit.
 */
function summarizeCapabilities(
  catalog: CatalogPayload | null,
  methods: ConnectionMethod[],
  hasOauth: boolean
): AppCapabilitySummary {
  return {
    tools: toCapabilityGroup((catalog?.tools ?? []).map((t) => t.name)),
    quickActions: toCapabilityGroup((catalog?.actions ?? []).map((a) => a.label)),
    workflowBlocks: toCapabilityGroup([
      ...(catalog?.workflow?.blocks ?? []).map((b) => b.label),
      ...(catalog?.workflow?.triggers ?? []).map((t) => t.label),
    ]),
    dataConnectors: toCapabilityGroup((catalog?.dataConnectors ?? []).map((c) => c.label)),
    connection: deriveConnectionDescriptor(methods, hasOauth),
  }
}

/** Pick a short label for the connection badge, or null when the app needs no connection. */
function deriveConnectionDescriptor(
  methods: ConnectionMethod[],
  hasOauth: boolean
): { label: string } | null {
  const only = methods.length === 1 ? methods[0] : undefined
  if (only) return { label: only.label }
  if (methods.length > 1) return { label: 'Connection' }
  if (hasOauth) return { label: 'OAuth connection' }
  return null
}
