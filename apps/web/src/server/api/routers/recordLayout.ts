// apps/web/src/server/api/routers/recordLayout.ts

import { onCacheEvent } from '@auxx/lib/cache'
import type { CapabilitySet } from '@auxx/lib/permissions'
import {
  getRecordLayoutDeltas,
  type RecordLayoutTarget,
  recordLayoutDeltaSchema,
  recordLayoutSurfaces,
  resetOrgRecordLayout,
  resetPersonalRecordLayout,
  saveOrgRecordLayout,
  savePersonalRecordLayout,
} from '@auxx/lib/record-layout'
import { z } from 'zod'
import { capabilityProcedure, createTRPCRouter } from '~/server/api/trpc'

/**
 * The stored half of the record layout system
 * (`plans/drawer/record-layout-system.md` §5).
 *
 * Two layers, two gates:
 *
 * - **org** (`saveOrg` / `resetOrg`) writes the `isShared` + `isDefault`
 * `TableView` row for the definition. Structural, so it goes through the same
 * def-admin gate `tableView.create` / `tableView.setDefault` use. Saving here
 * changes the drawer for everyone in the org.
 * - **personal** (`savePersonal` / `resetPersonal`) writes the acting member's
 * `TableViewPreference`. Per §9.5 personal tab order and hiding already ships
 * for every member via localStorage, so gating this on def-admin would take a
 * working feature away: any member who can view the definition may write it.
 *
 * Both store a SPARSE delta and never a snapshot. `recordLayoutDeltaSchema` is
 * strip-mode, so a client that tries to persist a capability key writes nothing.
 */

const surfaceSchema = z.enum(recordLayoutSurfaces)

const targetSchema = z.object({
  entityDefinitionId: z.string().min(1),
  surface: surfaceSchema,
})

/** Effective Read on the definition is enough to READ or personalise a layout. */
function assertViewAccess(capabilities: CapabilitySet, entityDefinitionId: string): void {
  capabilities.assertViewEntity(entityDefinitionId)
}

/**
 * Gate an ORG layout write: def administration (`Full`/`admin`) for the
 * definition, the same rule `tableView.assertStructuralAccess` applies to a
 * panel field config, because a record layout is the same kind of row one level
 * up.
 *
 * `tableView`'s version also carries an org-admin fallback for a view that
 * belongs to no definition. There is no such case here: a layout is always keyed
 * by `entityDefinitionId`, which the input requires, so the fallback would be
 * dead code.
 */
function assertStructuralAccess(capabilities: CapabilitySet, entityDefinitionId: string): void {
  capabilities.assertAdministerDef(entityDefinitionId)
}

export const recordLayoutRouter = createTRPCRouter({
  /**
   * Both stored layers for one definition on one surface. Either may be `null`,
   * which means "the registry default, unchanged": the caller composes the
   * registry layer itself with `buildRegistryLayout`.
   */
  get: capabilityProcedure.input(targetSchema).query(async ({ ctx, input }) => {
    assertViewAccess(ctx.capabilities, input.entityDefinitionId)

    const target: RecordLayoutTarget = {
      organizationId: ctx.session.organizationId,
      userId: ctx.session.userId,
      entityDefinitionId: input.entityDefinitionId,
      surface: input.surface,
    }
    const result = await getRecordLayoutDeltas(ctx.db, target)
    if (result.isErr()) throw result.error
    return result.value
  }),

  /** Write the org layout. Def-admin only: this changes the surface for everyone. */
  saveOrg: capabilityProcedure
    .input(targetSchema.extend({ delta: recordLayoutDeltaSchema }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      assertViewAccess(ctx.capabilities, input.entityDefinitionId)
      assertStructuralAccess(ctx.capabilities, input.entityDefinitionId)

      const result = await saveOrgRecordLayout(
        ctx.db,
        {
          organizationId,
          userId,
          entityDefinitionId: input.entityDefinitionId,
          surface: input.surface,
        },
        input.delta
      )
      if (result.isErr()) throw result.error

      await onCacheEvent('table-view.updated', {
        orgId: organizationId,
        userId,
        broadcastUserKeys: true,
      })
      return result.value
    }),

  /** Write the acting member's personal layout. Open to any member who can view the def. */
  savePersonal: capabilityProcedure
    .input(targetSchema.extend({ delta: recordLayoutDeltaSchema }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      assertViewAccess(ctx.capabilities, input.entityDefinitionId)

      const result = await savePersonalRecordLayout(
        ctx.db,
        {
          organizationId,
          userId,
          entityDefinitionId: input.entityDefinitionId,
          surface: input.surface,
        },
        input.delta
      )
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Delete the org layout, returning the surface to the registry default.
   * Destructive for the whole org, so it carries the same def-admin gate as the
   * write and the UI confirms first (§9.5).
   */
  resetOrg: capabilityProcedure.input(targetSchema).mutation(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session
    assertViewAccess(ctx.capabilities, input.entityDefinitionId)
    assertStructuralAccess(ctx.capabilities, input.entityDefinitionId)

    const result = await resetOrgRecordLayout(ctx.db, {
      organizationId,
      userId,
      entityDefinitionId: input.entityDefinitionId,
      surface: input.surface,
    })
    if (result.isErr()) throw result.error

    await onCacheEvent('table-view.deleted', {
      orgId: organizationId,
      userId,
      broadcastUserKeys: true,
    })
    return { success: true }
  }),

  /** Delete the acting member's personal layout. */
  resetPersonal: capabilityProcedure.input(targetSchema).mutation(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session
    assertViewAccess(ctx.capabilities, input.entityDefinitionId)

    const result = await resetPersonalRecordLayout(ctx.db, {
      organizationId,
      userId,
      entityDefinitionId: input.entityDefinitionId,
      surface: input.surface,
    })
    if (result.isErr()) throw result.error
    return { success: true }
  }),
})
