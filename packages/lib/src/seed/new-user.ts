// packages/lib/src/seed/new-user.ts

import { env } from '@auxx/config/server'
import { database as db, schema } from '@auxx/database'
import {
  InvitationStatus,
  OrganizationRole as OrganizationRoleEnum,
  OrganizationType,
} from '@auxx/database/enums'
import type { UserEntity } from '@auxx/database/models'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, gt } from 'drizzle-orm'
import { SuperAdminService } from '../admin/super-admin-service'
import { MemberService } from '../members/member-service'
import { SystemUserService } from '../users/system-user-service'
import { OrganizationSeeder } from './organization-seeder'
import { UserSeeder } from './user-seeder'

const logger = createScopedLogger('seed-new-user')

// Default organization settings to seed
const defaultOrganizationSettings = {
  type: OrganizationType.TEAM, // Using your OrganizationType enum
}

export async function seedNewUserDatabase(user: {
  id: string
  name?: string | null
  email?: string | null
  image?: string | null
}): Promise<UserEntity | undefined> {
  // user.
  logger.info(`Seeding database for new user: ${user.id}`)
  if (!user.id || !user.email) {
    console.error('Cannot seed database: User ID or Email missing.', user)
    return
  }
  await checkSuperAdminUser(user.email)

  try {
    logger.info(`Create default organization: ${user.id}`)
    const pendingInvite = await getPendingInvite(user.email) // Check for pending invites
    const shouldSeed = await shouldSeedDefaultOrg(user.id, user.email, pendingInvite) // Check if we should seed the default organization
    console.warn('SHOULD SEED:', shouldSeed)
    if (shouldSeed) {
      // Create default organization for the user first
      const organization = await db.transaction(async (tx) => {
        const [org] = await tx
          .insert(schema.Organization)
          .values({
            type: OrganizationType.TEAM,
            name: '',
            createdById: user.id,
            updatedAt: new Date(),
          })
          .returning()
        // Create organization membership
        await tx.insert(schema.OrganizationMember).values({
          userId: user.id,
          organizationId: org!.id,
          role: OrganizationRoleEnum.OWNER,
          updatedAt: new Date(),
        })
        return org
      })

      const organizationId = organization!.id
      logger.info(`Created organization: ${organization!.id}`)
      // Create system user for the organization
      await SystemUserService.createSystemUserForOrganization(
        organizationId,
        organization!.name || undefined
      )
      logger.info(`Created system user for org: ${organization!.id}`)

      // Set as default organization for the user
      const [updatedUser] = await db
        .update(schema.User)
        .set({ defaultOrganizationId: organizationId, completedOnboarding: false })
        .where(eq(schema.User.id, user.id))
        .returning()

      logger.info(`update defaultOrganizationId for user: ${updatedUser!.id}`)

      // Seed user-specific data (avatar migration, etc.)
      const userSeeder = new UserSeeder(organizationId, { ...user, ...updatedUser! }, db)
      await userSeeder.seedNewUser()

      const seeder = new OrganizationSeeder(db, user.id, user.email ?? undefined)
      await seeder.seedNewOrganization(organizationId)
      return updatedUser
    } else if (pendingInvite) {
      // Accept the pending invite.
      const invitationId = pendingInvite.id
      const organizationId = pendingInvite.organizationId
      const memberService = new MemberService(db)
      await memberService.acceptInvitationByIdentity({
        invitationId,
        acceptingUserId: user.id,
        acceptingUserEmail: user.email,
      })

      const [updatedUser] = await db
        .update(schema.User)
        .set({
          defaultOrganizationId: organizationId,
          completedOnboarding: true, // Needs onboarding for the *invited* org later
        })
        .where(eq(schema.User.id, user.id))
        .returning()

      // Seed user-specific data with invited organization
      const userSeeder = new UserSeeder(organizationId, { ...user, ...updatedUser! }, db)
      await userSeeder.seedNewUser()
      return updatedUser
    } else {
      const [updatedUser] = await db
        .update(schema.User)
        .set({
          defaultOrganizationId: null, // Explicitly null
          completedOnboarding: true, // Needs onboarding for the *invited* org later
        })
        .where(eq(schema.User.id, user.id))
        .returning()

      // Try to find user's first organization membership for seeding
      const [membership] = await db
        .select({ organizationId: schema.OrganizationMember.organizationId })
        .from(schema.OrganizationMember)
        .where(eq(schema.OrganizationMember.userId, user.id))
        .limit(1)

      // Only seed user-specific data if we have an organization
      if (membership?.organizationId) {
        const userSeeder = new UserSeeder(
          membership.organizationId,
          { ...user, ...updatedUser! },
          db
        )

        await userSeeder.seedNewUser()
      } else {
        logger.warn('Cannot seed user data - no organization available', {
          userId: user.id,
          hasImage: !!user.image,
        })
      }
      return updatedUser
    }

    // logger.info(`Database seeded for user: ${user.id}`)
  } catch (error) {
    logger.error('Error seeding database for new user:', { error })
  }
}
// async function setImage()
type PendingInvite = {
  id: string
  organizationId: string
}

async function checkSuperAdminUser(email: string) {
  // Check if this user should be promoted to super admin
  const superAdminEmail = env.SUPER_ADMIN_EMAIL + ''
  if (superAdminEmail && email && email.toLowerCase() === superAdminEmail.toLowerCase()) {
    try {
      const superAdminService = new SuperAdminService(db)
      await superAdminService.promoteUserToSuperAdmin(email)
      logger.info('Successfully promoted user to super admin', { email })
    } catch (error) {
      logger.error('Failed to promote user to super admin during seeding', {
        email,
        error,
      })
    }
  }
}

async function getPendingInvite(email: string): Promise<PendingInvite | null> {
  const [pendingInvite] = await db
    .select({
      id: schema.OrganizationInvitation.id,
      organizationId: schema.OrganizationInvitation.organizationId,
    })
    .from(schema.OrganizationInvitation)
    .where(
      and(
        eq(schema.OrganizationInvitation.email, email.toLowerCase()),
        eq(schema.OrganizationInvitation.status, InvitationStatus.PENDING),
        gt(schema.OrganizationInvitation.expiresAt, new Date())
      )
    )
    .limit(1)
  return pendingInvite || null
}

async function shouldSeedDefaultOrg(
  userId: string,
  email: string,
  pendingInvite: PendingInvite | null
) {
  let shouldSeed = true
  try {
    if (pendingInvite) {
      // Pending invite found - DO NOT seed default org
      logger.info(
        `User ${userId} has a pending invitation (${pendingInvite.id} for org ${pendingInvite.organizationId}). Skipping default organization seed.`
      )
      shouldSeed = false
    } else {
      logger.info(
        `User ${userId} has no pending invitations. Will proceed with default organization seed if no memberships exist.`
      )
      // We still need to check for existing memberships in case of race conditions or other edge cases
      const [existingMembership] = await db
        .select({ id: schema.OrganizationMember.id })
        .from(schema.OrganizationMember)
        .where(eq(schema.OrganizationMember.userId, userId))
        .limit(1)

      if (existingMembership) {
        logger.warn(
          `User ${userId} already has an organization membership (${existingMembership.id}) despite no pending invite found? Skipping default org seed.`
        )
        shouldSeed = false
      }
    }
  } catch (error) {
    logger.error(`Error checking for pending invitations/memberships for user ${userId}:`, error)
    // Fail safe: Don't seed if the check errors out.
    shouldSeed = false
    logger.warn(`Skipping seeding for user ${userId} due to error during pre-seed checks.`)
  }
  return shouldSeed
}
