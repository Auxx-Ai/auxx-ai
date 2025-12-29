import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { SettingsService, UserSettingsService } from '@auxx/lib/settings'
import { autoSyncShopify } from '@auxx/lib/shopify'
import { MediaAssetService } from '@auxx/lib/files'
import { database as db, schema } from '@auxx/database'
import { eq, count } from 'drizzle-orm'

import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'
import { FeaturePermissionService } from '@auxx/lib/permissions'

export const userRouter = createTRPCRouter({
  // getUser: protectedProcedure.input()

  updateProfile: protectedProcedure
    .input(
      z.object({
        firstName: z.string().min(1).optional(),
        lastName: z.string().min(1).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const updates: any = {}

      // Update separate fields
      if (input.firstName !== undefined) updates.firstName = input.firstName
      if (input.lastName !== undefined) updates.lastName = input.lastName

      // Update full name field as well for display purposes
      if (input.firstName !== undefined || input.lastName !== undefined) {
        const [user] = await db
          .select({ firstName: schema.User.firstName, lastName: schema.User.lastName })
          .from(schema.User)
          .where(eq(schema.User.id, ctx.session.user.id))
          .limit(1)
        updates.name =
          `${input.firstName || user?.firstName || ''} ${input.lastName || user?.lastName || ''}`.trim()
      }

      const [updatedUser] = await db
        .update(schema.User)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(schema.User.id, ctx.session.user.id))
        .returning()

      return updatedUser
    }),

  me: protectedProcedure.query(async ({ ctx }) => {
    const { userId, organizationId } = ctx.session

    // Fetch user with selected fields
    const [user] = await db
      .select({
        id: schema.User.id,
        name: schema.User.name,
        email: schema.User.email,
        emailVerified: schema.User.emailVerified,

        image: schema.User.image,
        avatarAssetId: schema.User.avatarAssetId,
        defaultOrganizationId: schema.User.defaultOrganizationId,
        completedOnboarding: schema.User.completedOnboarding,
        phoneNumber: schema.User.phoneNumber,
        phoneNumberVerified: schema.User.phoneNumberVerified,
        firstName: schema.User.firstName,
        lastName: schema.User.lastName,
        lastLoginAt: schema.User.lastLoginAt,
        preferredTimezone: schema.User.preferredTimezone,
      })
      .from(schema.User)
      .where(eq(schema.User.id, userId))
      .limit(1)

    if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' })

    // Fetch user memberships with organization details separately
    const memberships = await db
      .select({
        id: schema.OrganizationMember.id,
        userId: schema.OrganizationMember.userId,
        organizationId: schema.OrganizationMember.organizationId,
        role: schema.OrganizationMember.role,
        organization: {
          id: schema.Organization.id,
          name: schema.Organization.name,
          website: schema.Organization.website,
          email_domain: schema.Organization.emailDomain,
        },
      })
      .from(schema.OrganizationMember)
      .leftJoin(
        schema.Organization,
        eq(schema.Organization.id, schema.OrganizationMember.organizationId)
      )
      .where(eq(schema.OrganizationMember.userId, userId))

    // Fetch user settings
    const settingsService = new SettingsService(db)
    const settings = await settingsService.getAllUserSettings({ userId, organizationId })

    const featureService = new FeaturePermissionService(db)
    const features = await featureService.getOrganizationFeaturesMap(organizationId)

    const [{ integrationCount }] = await db
      .select({ integrationCount: count() })
      .from(schema.Integration)
      .where(eq(schema.Integration.organizationId, organizationId))
    const hasIntegrations = integrationCount > 0

    // Fetch avatar URL if user has an avatar asset
    let avatarUrl: string | null = null
    if (user.avatarAssetId) {
      const mediaAssetService = new MediaAssetService(organizationId, userId, db)
      avatarUrl = await mediaAssetService.getDownloadUrl(user.avatarAssetId)
    }

    // Return user object with settings property
    return { ...user, memberships, settings, features, hasIntegrations, image: avatarUrl }
  }),

  teamMembers: protectedProcedure.query(async ({ ctx }) => {
    const organizationId = ctx.session.user.defaultOrganizationId
    if (!organizationId) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID is required' })
    }

    const members = await db
      .select({
        id: schema.User.id,
        name: schema.User.name,
        email: schema.User.email,
      })
      .from(schema.OrganizationMember)
      .leftJoin(schema.User, eq(schema.User.id, schema.OrganizationMember.userId))
      .where(eq(schema.OrganizationMember.organizationId, organizationId))

    return members
  }),

  settings: protectedProcedure.query(async ({ ctx }) => {
    // return ctx.db.user.findUnique({
    //   where: { id: ctx.session.user.id },
    //   select: { settings: true },
    // })
    const userId = ctx.session.user.id
    const settings = await UserSettingsService.get(userId)

    return settings
  }),
  updateSettings: protectedProcedure
    .input(z.object({ settings: z.record(z.string(), z.any()) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id
      const result = await UserSettingsService.update(userId, input.settings)
      return result
    }),

  updateSetting: protectedProcedure
    .input(z.object({ path: z.string(), value: z.any() }))
    .mutation(async ({ ctx, input }) => {
      // const userId = ctx.session.user.id
      const { organizationId, userId } = ctx.session

      await UserSettingsService.set(userId, input.path, input.value)

      if (input.path == 'shopify.autoSync') {
        autoSyncShopify(userId, organizationId)
      }
    }),

  removeAvatar: protectedProcedure.mutation(async ({ ctx }) => {
    const { userId, organizationId } = ctx.session

    // Get current user to check if they have an avatar
    const [user] = await db
      .select({ avatarAssetId: schema.User.avatarAssetId })
      .from(schema.User)
      .where(eq(schema.User.id, userId))
      .limit(1)

    if (!user?.avatarAssetId) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'No avatar to remove' })
    }

    // Use MediaAssetService to delete the avatar asset
    const mediaAssetService = new MediaAssetService(organizationId, userId, db)
    await mediaAssetService.delete(user.avatarAssetId)

    // Clear the avatarAssetId reference from the user
    await db
      .update(schema.User)
      .set({ avatarAssetId: null, updatedAt: new Date() })
      .where(eq(schema.User.id, userId))

    return { success: true }
  }),

  updateTimezone: protectedProcedure
    .input(
      z.object({
        timezone: z.string().min(1, 'Timezone is required'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id

      // Validate timezone string (basic check)
      const validTimezonePattern = /^[A-Za-z]+\/[A-Za-z_]+$/
      if (!validTimezonePattern.test(input.timezone) && input.timezone !== 'UTC') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid timezone format. Expected format: "America/Los_Angeles" or "UTC"',
        })
      }

      const [updatedUser] = await db
        .update(schema.User)
        .set({
          preferredTimezone: input.timezone,
          updatedAt: new Date(),
        })
        .where(eq(schema.User.id, userId))
        .returning()

      return updatedUser
    }),
})
