// apps/web/src/server/api/routers/label.ts

import { schema } from '@auxx/database'
import { getCachedUserInstanceGrants } from '@auxx/lib/cache'
import { listManageableChannelIds, requireChannelManageAccess } from '@auxx/lib/channels'
import {
  addLabelToThread,
  createLabel,
  deleteLabel,
  discoverAndUpsertFolders,
  getLabelById,
  listLabels,
  listThreadLabels,
  removeLabelFromThread,
  setLabelEnabled,
  setLabelVisibility,
  syncAllIntegrationLabels,
  syncIntegrationLabels,
  updateLabel,
} from '@auxx/lib/email/labels'
import { BadRequestError, NotFoundError } from '@auxx/lib/errors'
import { PermissionKey } from '@auxx/lib/permissions/capabilities/registry'
import { ProviderRegistryService } from '@auxx/lib/providers'
import { assertCanActOnThreads } from '@auxx/lib/threads/thread-action-access'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, permissionProcedure, protectedProcedure } from '../trpc'

/**
 * TRPC router for labels/folders — a mail channel's sync configuration.
 *
 * Thin glue, per `snippet.ts`: zod input → assert access → call an
 * `@auxx/lib/email/labels` helper → unwrap the `Result`. Every query, provider
 * call and transaction lives in lib; there is no `try/catch` and no `TRPCError`
 * here, because `auxxErrorMiddleware` (`trpc.ts`) already maps every `AuxxError`
 * to the right code. That is also what finally makes
 * `ReauthenticationRequiredError` (401) surface correctly on **all** procedures —
 * it used to be special-cased in exactly one of nine catch blocks, so an expired
 * token on `sync` read as a generic "Failed to sync labels" 500.
 *
 * **`integrationType` throughout this file means `Integration.provider`**
 * (`'google'`, `'outlook'`, `'imap'`, …), not a "type of integration". The name is
 * historical; it used to be restated in nine identical comments, so it is stated
 * once here.
 *
 * ## Authority (plan §5)
 *
 * Channels are **not** an `INSTANCE_ACCESS_RESOURCES` entry and `Integration` has
 * no owner column — but a channel is personal iff its linked inbox is personal, so
 * the predicate is `requireChannelManageAccess`, **not**
 * `permissionProcedure(channelsManage)`. #1396 exists because the coarse key 403'd
 * the owner of a personal channel out of their own channel's settings page. Three
 * tiers, read off `channel.ts`:
 *
 *  - **Per-channel** (`getIntegrationLabels`, `discoverFolders`, `create`,
 *    `update`, `remove`, `sync`) → `requireChannelManageAccess(ctx, integrationId)`,
 *    the same authority as `channel.toggle` / `syncMessages` / `disconnect`.
 *  - **Label-keyed** (`toggleLabelEnabled`, `setVisibility`) → resolve the label
 *    ORG-SCOPED first, then authorize on the channel it belongs to, so a
 *    foreign-org id 404s *before* any authorization decision leaks its existence.
 *  - **Org-wide** (`syncAll`) → `permissionProcedure(channelsManage)`; there is no
 *    single channel to key on, matching `channel.syncAllMessages`.
 *  - **`list`** scopes instead of asserting (§5.3): a settings-surface read must
 *    filter, not 403, or a server-warmed page call fails for a non-admin.
 *
 * Thread label ops are **mail actions, not channel config**, so they answer to the
 * mail authority: `inboxes.view` as the front door (plan 40 — every `thread.*`
 * procedure gates on that and nothing finer) plus `assertCanActOnThreads` for the
 * two writes. Deliberately **no** inbox-instance assert (§5.2 / plan 40 §1.4): in
 * a dispatch org the assignee holds no `ResourceAccess` row on the inbox, so an
 * instance gate would deny exactly the people the model exists to serve.
 *
 * `notDemo` is not applied to any label procedure and this refactor does not add
 * it.
 */

const mailProcedure = permissionProcedure(PermissionKey.inboxesView)

/** Provider + DB coordinates every per-channel label operation needs. */
const integrationRef = {
  integrationType: z.string(),
  integrationId: z.string(),
}

export const labelRouter = createTRPCRouter({
  /**
   * List the org's labels, narrowed to the channels the caller may MANAGE.
   *
   * Scope, not assert (§5.3): `listManageableChannelIds` is applied as SQL inside
   * `listLabels`, and an empty allowlist becomes an explicit false predicate
   * rather than a dropped `inArray` — the footgun that turns "sees nothing" into
   * "sees everything".
   *
   * This is a **settings-surface** read. If the half-built mail sidebar at
   * `app/mail/_[labelId]/` is ever revived it wants a different scope — "labels of
   * channels whose inbox I can *view*", closer to `channels/list.ts` — so decide
   * that before wiring a mail lens to this procedure (plan D2).
   *
   * Replaces `all` and `getLabels`, which differed only in which filters they
   * applied; `getLabels` additionally built a provider it never used, making every
   * list an accidental credential probe.
   */
  list: protectedProcedure
    .input(
      z
        .object({ integrationType: z.string().optional(), integrationId: z.string().optional() })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const scope = await listManageableChannelIds({ db: ctx.db, organizationId, userId })
      const result = await listLabels(ctx.db, organizationId, {
        integrationType: input?.integrationType,
        integrationId: input?.integrationId,
        scope,
      })
      if (result.isErr()) throw result.error
      return { labels: result.value }
    }),

  /**
   * Get labels for an integration (reads DB directly, bypasses the label provider).
   *
   * Per-CHANNEL authority, so it takes `requireChannelManageAccess` rather than a
   * bare `channels.manage` assert: a member who owns a personal channel manages
   * its label/folder sync scope (§11), and the coarse key alone 403'd them out of
   * their own channel's settings page.
   */
  getIntegrationLabels: protectedProcedure
    .input(z.object({ integrationId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      await requireChannelManageAccess({ db: ctx.db, organizationId, userId }, input.integrationId)
      const result = await listLabels(ctx.db, organizationId, {
        integrationId: input.integrationId,
      })
      if (result.isErr()) throw result.error
      return { labels: result.value }
    }),

  /** Labels applied to one thread — a mail read, so `inboxes.view`. */
  getThreadLabels: mailProcedure
    .input(z.object({ threadId: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await listThreadLabels(ctx.db, ctx.session.organizationId, input.threadId)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Create a label in the provider and mirror it. Per-channel authority — this
   * writes to the customer's actual Gmail/Outlook account and was a bare
   * `protectedProcedure` reading zero capabilities before this slice.
   */
  create: protectedProcedure
    .input(
      z.object({
        ...integrationRef,
        name: z.string(),
        backgroundColor: z.string().optional(),
        textColor: z.string().optional(),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      await requireChannelManageAccess({ db: ctx.db, organizationId, userId }, input.integrationId)
      const result = await createLabel(ctx.db, organizationId, input)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /** Rename/recolor a label in the provider and mirror it. Per-channel authority. */
  update: protectedProcedure
    .input(
      z.object({
        ...integrationRef,
        labelId: z.string(),
        name: z.string().optional(),
        backgroundColor: z.string().optional(),
        textColor: z.string().optional(),
        description: z.string().optional(),
        isVisible: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      await requireChannelManageAccess({ db: ctx.db, organizationId, userId }, input.integrationId)
      const result = await updateLabel(ctx.db, organizationId, {
        integrationType: input.integrationType,
        integrationId: input.integrationId,
        labelId: input.labelId,
        changes: {
          name: input.name,
          backgroundColor: input.backgroundColor,
          textColor: input.textColor,
          description: input.description,
          isVisible: input.isVisible,
        },
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /** Delete a label from the provider, then drop our row. Per-channel authority. */
  remove: protectedProcedure
    .input(z.object({ ...integrationRef, labelId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      await requireChannelManageAccess({ db: ctx.db, organizationId, userId }, input.integrationId)
      const result = await deleteLabel(ctx.db, organizationId, input)
      if (result.isErr()) throw result.error
      return { success: true }
    }),

  /** Reconcile one channel's labels against its provider. Per-channel authority. */
  sync: protectedProcedure.input(z.object(integrationRef)).mutation(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session
    await requireChannelManageAccess({ db: ctx.db, organizationId, userId }, input.integrationId)
    const result = await syncIntegrationLabels(ctx.db, organizationId, input)
    if (result.isErr()) throw result.error
    return result.value
  }),

  /**
   * Reconcile EVERY live channel in the org.
   *
   * The one place the coarse key is right: there is no single channel to key on,
   * so this matches `channel.syncAllMessages` and gates on `channels.manage`. A
   * personal-channel owner is deliberately denied — they may sync their own
   * channel via {@link sync}, not the whole org's.
   *
   * Per-integration failures come back inside the array (`{ ok: false, error }`),
   * so one expired token no longer blanks every other channel's labels.
   */
  syncAll: permissionProcedure(PermissionKey.channelsManage).mutation(async ({ ctx }) => {
    const result = await syncAllIntegrationLabels(ctx.db, ctx.session.organizationId)
    if (result.isErr()) throw result.error
    return result.value
  }),

  /**
   * Toggle `Label.enabled` — changes what the channel syncs, so it is authorized
   * on the CHANNEL the label belongs to (same carve-out as
   * {@link getIntegrationLabels}). The label is resolved org-scoped first, so an
   * id from another org is a 404 before any authorization decision is made.
   */
  toggleLabelEnabled: protectedProcedure
    .input(z.object({ labelId: z.string(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const label = await getLabelById(ctx.db, organizationId, input.labelId)
      if (label.isErr()) throw label.error
      await requireChannelManageAccess(
        { db: ctx.db, organizationId, userId },
        label.value.integrationId
      )
      const result = await setLabelEnabled(ctx.db, organizationId, input.labelId, input.enabled)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Show/hide a label in OUR UI. DB-only (no provider call), but it is still
   * channel sync config, so it lands on the same authority and the same
   * resolve-then-authorize ordering as {@link toggleLabelEnabled} — two adjacent
   * toggles on one row must not have different gates.
   */
  setVisibility: protectedProcedure
    .input(z.object({ labelId: z.string(), visible: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const label = await getLabelById(ctx.db, organizationId, input.labelId)
      if (label.isErr()) throw label.error
      await requireChannelManageAccess(
        { db: ctx.db, organizationId, userId },
        label.value.integrationId
      )
      const result = await setLabelVisibility(ctx.db, organizationId, input.labelId, input.visible)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Ask the provider for its folder list and persist it. Per-channel authority,
   * same carve-out as {@link getIntegrationLabels}.
   */
  discoverFolders: protectedProcedure
    .input(z.object({ integrationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      await requireChannelManageAccess({ db: ctx.db, organizationId, userId }, input.integrationId)

      const [integration] = await ctx.db
        .select({ provider: schema.Integration.provider })
        .from(schema.Integration)
        .where(
          and(
            eq(schema.Integration.id, input.integrationId),
            eq(schema.Integration.organizationId, organizationId),
            isNull(schema.Integration.deletedAt)
          )
        )
        .limit(1)

      if (!integration) throw new NotFoundError('Integration not found')

      const registry = new ProviderRegistryService(organizationId)
      const providerInstance = await registry.getProvider(input.integrationId)
      if (!providerInstance.discoverLabels) {
        throw new BadRequestError('This provider does not support folder discovery')
      }

      const discovered = await discoverAndUpsertFolders(ctx.db, organizationId, {
        integrationId: input.integrationId,
        provider: integration.provider,
        discoveredFolders: await providerInstance.discoverLabels(),
      })
      if (discovered.isErr()) throw discovered.error

      const result = await listLabels(ctx.db, organizationId, {
        integrationId: input.integrationId,
      })
      if (result.isErr()) throw result.error
      return { labels: result.value }
    }),

  /**
   * Apply a label to a thread. A mail ACTION: `inboxes.view` front door plus
   * `assertCanActOnThreads`, which is the entirety of per-thread write authority
   * (plan 40 §1.1 — seeing a thread at `full` lens IS the permission to act on
   * it). No channel gate: the caller is acting on a conversation, not
   * reconfiguring a channel.
   */
  addLabelToThread: mailProcedure
    .input(z.object({ ...integrationRef, labelId: z.string(), threadId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const viewer = await getCachedUserInstanceGrants(userId, organizationId)
      await assertCanActOnThreads(ctx.db, organizationId, viewer, [input.threadId])
      const result = await addLabelToThread(ctx.db, organizationId, input)
      if (result.isErr()) throw result.error
      return { success: true }
    }),

  /** Remove a label from a thread. Same authority as {@link addLabelToThread}. */
  removeLabelFromThread: mailProcedure
    .input(z.object({ ...integrationRef, labelId: z.string(), threadId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const viewer = await getCachedUserInstanceGrants(userId, organizationId)
      await assertCanActOnThreads(ctx.db, organizationId, viewer, [input.threadId])
      const result = await removeLabelFromThread(ctx.db, organizationId, input)
      if (result.isErr()) throw result.error
      return { success: true }
    }),
})
