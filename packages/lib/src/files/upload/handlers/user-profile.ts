// packages/lib/src/files/upload/handlers/user-profile.ts

import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { isAgentUser } from '../../../cache'
import { BadRequestError, NotFoundError } from '../../../errors'
import { isMember } from '../../../members'
import { ENTITY_TYPES } from '../../types/entities'
import { ASSET_MAX_TTL_SEC, MB } from './shared'
import type { UploadHandler } from './types'

const logger = createScopedLogger('upload-handler-user-profile')

/**
 * Avatars for real users and for the synthetic users backing agents.
 *
 * The only `versioned-asset` handler: a second avatar upload adds a version to
 * the user's existing `USER_AVATAR` asset rather than minting a new one, so
 * `User.avatarAssetId` stays stable and the thumbnail latch keys stay stable
 * with it.
 *
 * ## The admin gate is NOT here
 *
 * `UserProfileProcessor.validateEntityAccess` ran `isAdminOrOwner` before
 * allowing an upload aimed at another user. That is authorization, and lib
 * performs none (`docs/lib-module-guide.md` §6) — it moved to
 * `apps/web/src/app/api/files/upload/sessions/route.ts`, alongside the
 * `files.manage` gate that was already there. What remains below is the
 * identity half: the target has to be *a* user of this organization.
 */
export const userProfileHandler: UploadHandler = {
  entityType: ENTITY_TYPES.USER_PROFILE,
  // The avatar's owner is the entity. A client that omits `entityId` means
  // "mine", and the storage key has to say so before it is derived.
  normalizeInit: (init) => ({ ...init, entityId: init.entityId || init.userId }),
  visibility: 'PUBLIC',
  maxFileSize: 5 * MB,
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  maxTtlSec: ASSET_MAX_TTL_SEC,
  assetKind: 'USER_AVATAR',
  persist: 'versioned-asset',

  async validateEntity(ctx, init) {
    const target = init.entityId || init.userId

    // Self-upload: the classic profile flow. The uploader must belong here.
    if (target === init.userId) {
      if (!(await isMember(init.userId, ctx.organizationId))) {
        throw new NotFoundError('User not found in organization')
      }
      return
    }

    // Cross-user upload is only meaningful for the synthetic `User` backing an
    // Agent in this org — agents share the `User.avatarAssetId` pipeline. Who
    // may perform it is the route's question, not this one's.
    if (!(await isAgentUser(ctx.organizationId, target))) {
      throw new NotFoundError('Avatar target is not a user of this organization')
    }
  },

  /**
   * Point the user row at the new asset, and show the original immediately.
   *
   * `image` is set to the original object's URL rather than left for the
   * `avatar-64` thumbnail job, so the new avatar renders on the next paint
   * instead of after the worker turns around.
   */
  async onPersist(tx, _ctx, _deps, result, session) {
    const targetUserId = session.entityId || session.userId
    if (!targetUserId) throw new BadRequestError('Cannot determine user ID for avatar update')

    await tx
      .update(schema.User)
      .set({ avatarAssetId: result.assetId, image: result.externalUrl || null })
      .where(eq(schema.User.id, targetUserId))
  },

  /**
   * Bust what renders the avatar.
   *
   * Both imports are lazy: they are the cold path, and `files/` reaching
   * `cache/` or `dehydration/` at module scope is an import cycle waiting to
   * happen. Each is guarded on its own so a failing dehydration bust does not
   * cost the agents bust — they invalidate different readers.
   */
  async afterCommit(ctx, _deps, _result, session) {
    const targetUserId = session.entityId || session.userId

    try {
      const { DehydrationService } = await import('../../../dehydration')
      await new DehydrationService().invalidateUser(targetUserId)
    } catch (error) {
      logger.error('Failed to invalidate the dehydrated user after an avatar upload', {
        sessionId: session.id,
        userId: targetUserId,
        error,
      })
    }

    // An admin uploading for an agent's synthetic user: bust the org `agents`
    // cache so the avatar URL refreshes on the next load. `validateEntity` is
    // what guarantees a mismatched `entityId` is an agent user rather than an
    // arbitrary one.
    if (!session.entityId || session.entityId === session.userId) return

    try {
      const { onCacheEvent } = await import('../../../cache')
      await onCacheEvent('agent.updated', { orgId: ctx.organizationId })
    } catch (error) {
      logger.error('Failed to bust the agents cache after an agent avatar upload', {
        sessionId: session.id,
        organizationId: ctx.organizationId,
        error,
      })
    }
  },

  thumbnails: {
    presets: ['avatar-32', 'avatar-64', 'avatar-128', 'avatar-256'],
    // Exactly one preset writes `User.image`, and the worker honours it for
    // `avatar-64` only — a second asker would mean two jobs racing for one column.
    perPreset: { 'avatar-64': { updateUser: true } },
    preview: 'avatar-32',
  },
}
