// packages/lib/src/admin/admin-service.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { OrganizationService } from '../organizations/organization-service'

const logger = createScopedLogger('admin-service')

/**
 * Organization with metrics for list view
 */
export interface OrganizationWithMetrics {
  id: string
  name: string | null
  handle: string | null
  type: string
  plan: string | null
  ownerEmail: string | null
  userCount: number
  messageCount: number
  createdAt: Date
  isTrialing: boolean
  trialDaysLeft: number | null
}

/**
 * User with metrics for list view
 */
export interface UserWithMetrics {
  id: string
  name: string | null
  email: string | null
  firstName: string | null
  lastName: string | null
  organizationCount: number
  emailVerified: boolean
  createdAt: Date
  lastActiveAt: Date | null
}

/**
 * Detailed user data for detail view
 */
export interface UserDetails {
  id: string
  name: string | null
  email: string | null
  firstName: string | null
  lastName: string | null
  phoneNumber: string | null
  phoneNumberVerified: boolean
  emailVerified: boolean
  image: string | null
  about: string | null
  completedOnboarding: boolean
  twoFactorEnabled: boolean
  isSuperAdmin: boolean
  lastActiveAt: Date | null
  createdAt: Date
  updatedAt: Date
  organizations: {
    id: string
    name: string | null
    handle: string | null
    role: string
    joinedAt: Date
  }[]
  metrics: {
    organizationCount: number
    messageCount: number
    ticketCount: number
  }
}

/**
 * Detailed organization data for detail view
 */
export interface OrganizationDetails {
  id: string
  name: string | null
  handle: string | null
  type: string
  website: string | null
  createdAt: Date
  updatedAt: Date
  disabledAt: Date | null
  disabledReason: string | null
  subscription: {
    id: string
    plan: string
    status: string
    billingCycle: string
    seats: number
    creditsBalance: number
    trialEnd: Date | null
    hasTrialEnded: boolean
    trialConversionStatus: string | null
    canceledAt: Date | null
    cancelAtPeriodEnd: boolean
    periodEnd: Date | null
    deletionScheduledDate: Date | null
    deletionReason: string | null
  } | null
  metrics: {
    userCount: number
    messageCount: number
    ticketCount: number
    workflowCount: number
    datasetCount: number
    documentCount: number
    contactCount: number
  }
}

/**
 * App with metrics for list view
 */
export interface AppWithMetrics {
  id: string
  slug: string
  title: string
  publicationStatus: string
  createdAt: Date
  developerAccount: {
    id: string
    title: string
    slug: string
  } | null
  latestVersion: string | null
}

/**
 * App details for detail view
 */
export interface AppDetails {
  id: string
  slug: string
  title: string
  description: string | null
  category: string | null
  publicationStatus: string
  reviewStatus: string | null
  autoApprove: boolean
  websiteUrl: string | null
  documentationUrl: string | null
  supportSiteUrl: string | null
  hasOauth: boolean
  hasBundle: boolean
  scopes: string[]
  createdAt: Date
  updatedAt: Date
  developerAccount: {
    id: string
    title: string
    slug: string
  } | null
  versions: Array<{
    id: string
    versionString: string
    publicationStatus: string | null
    reviewStatus: string | null
    status: string | null
    releasedAt: Date | null
    createdAt: Date
  }>
}

/**
 * Service class for admin operations
 */
export class AdminService {
  private db: Database
  private organizationService: OrganizationService

  /**
   * Creates an instance of AdminService.
   * @param db - The database instance.
   */
  constructor(db: Database) {
    this.db = db
    this.organizationService = new OrganizationService(db)
  }

  /**
   * Get organizations with aggregated metrics
   * @param params - Query parameters
   * @param params.limit - Maximum number of results to return
   * @param params.offset - Number of results to skip
   * @param params.search - Search term to filter by name or handle
   * @returns Array of organizations with metrics
   */
  async getOrganizations(params: {
    limit?: number
    offset?: number
    search?: string
  }): Promise<OrganizationWithMetrics[]> {
    const { limit = 10, offset = 0, search } = params

    logger.debug(`Fetching organizations with limit=${limit}, offset=${offset}, search=${search}`)

    // Build the query
    const orgs = await this.db
      .select({
        id: schema.Organization.id,
        name: schema.Organization.name,
        handle: schema.Organization.handle,
        type: schema.Organization.type,
        createdAt: schema.Organization.createdAt,
      })
      .from(schema.Organization)
      .where(
        search
          ? or(
              ilike(schema.Organization.name, `%${search}%`),
              ilike(schema.Organization.handle, `%${search}%`)
            )
          : undefined
      )
      .orderBy(desc(schema.Organization.createdAt))
      .limit(limit)
      .offset(offset)

    // Get metrics for each organization
    const orgsWithMetrics = await Promise.all(
      orgs.map(async (org) => {
        // Get user count
        const [userCountResult] = await this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.OrganizationMember)
          .where(eq(schema.OrganizationMember.organizationId, org.id))

        // Get message count
        const [messageCountResult] = await this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.Message)
          .where(eq(schema.Message.organizationId, org.id))

        // Get plan subscription with trial info
        const [subscription] = await this.db
          .select({
            planName: schema.Plan.name,
            trialStart: schema.PlanSubscription.trialStart,
            trialEnd: schema.PlanSubscription.trialEnd,
            hasTrialEnded: schema.PlanSubscription.hasTrialEnded,
          })
          .from(schema.PlanSubscription)
          .innerJoin(schema.Plan, eq(schema.PlanSubscription.planId, schema.Plan.id))
          .where(eq(schema.PlanSubscription.organizationId, org.id))
          .limit(1)

        // Get owner email
        const [owner] = await this.db
          .select({
            email: schema.User.email,
          })
          .from(schema.OrganizationMember)
          .innerJoin(schema.User, eq(schema.OrganizationMember.userId, schema.User.id))
          .where(
            sql`${schema.OrganizationMember.organizationId} = ${org.id} AND ${schema.OrganizationMember.role} = 'OWNER'`
          )
          .limit(1)

        // Calculate trial status
        const now = new Date()
        const isTrialing =
          subscription?.trialEnd &&
          !subscription.hasTrialEnded &&
          new Date(subscription.trialEnd) > now
        const trialDaysLeft = isTrialing
          ? Math.ceil(
              (new Date(subscription.trialEnd!).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
            )
          : null

        return {
          id: org.id,
          name: org.name,
          handle: org.handle,
          type: org.type,
          plan: subscription?.planName ?? null,
          ownerEmail: owner?.email ?? null,
          userCount: userCountResult?.count ?? 0,
          messageCount: messageCountResult?.count ?? 0,
          createdAt: new Date(org.createdAt),
          isTrialing: Boolean(isTrialing),
          trialDaysLeft,
        }
      })
    )

    logger.debug(`Found ${orgsWithMetrics.length} organizations`)
    return orgsWithMetrics
  }

  /**
   * Get single organization with detailed stats
   * @param id - Organization ID
   * @returns Organization details with full metrics
   */
  async getOrganization(id: string): Promise<OrganizationDetails | null> {
    logger.debug(`Fetching organization details for ${id}`)

    // Get organization
    const [org] = await this.db
      .select()
      .from(schema.Organization)
      .where(eq(schema.Organization.id, id))
      .limit(1)

    if (!org) {
      logger.warn(`Organization ${id} not found`)
      return null
    }

    // Get user count
    const [userCountResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.OrganizationMember)
      .where(eq(schema.OrganizationMember.organizationId, id))

    // Get message count
    const [messageCountResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.Message)
      .where(eq(schema.Message.organizationId, id))

    // Get ticket count
    const [ticketCountResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.Ticket)
      .where(eq(schema.Ticket.organizationId, id))

    // Get workflow count
    const [workflowCountResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.Workflow)
      .where(eq(schema.Workflow.organizationId, id))

    // Get dataset count
    const [datasetCountResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.Dataset)
      .where(eq(schema.Dataset.organizationId, id))

    // Get document count
    const [documentCountResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.Document)
      .where(eq(schema.Document.organizationId, id))

    // Get contact count
    const [contactCountResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.Contact)
      .where(eq(schema.Contact.organizationId, id))

    // Get subscription details
    const [subscription] = await this.db
      .select({
        id: schema.PlanSubscription.id,
        plan: schema.Plan.name,
        status: schema.PlanSubscription.status,
        billingCycle: schema.PlanSubscription.billingCycle,
        seats: schema.PlanSubscription.seats,
        creditsBalance: schema.PlanSubscription.creditsBalance,
        trialEnd: schema.PlanSubscription.trialEnd,
        hasTrialEnded: schema.PlanSubscription.hasTrialEnded,
        trialConversionStatus: schema.PlanSubscription.trialConversionStatus,
        canceledAt: schema.PlanSubscription.canceledAt,
        cancelAtPeriodEnd: schema.PlanSubscription.cancelAtPeriodEnd,
        periodEnd: schema.PlanSubscription.periodEnd,
        deletionScheduledDate: schema.PlanSubscription.deletionScheduledDate,
        deletionReason: schema.PlanSubscription.deletionReason,
      })
      .from(schema.PlanSubscription)
      .innerJoin(schema.Plan, eq(schema.PlanSubscription.planId, schema.Plan.id))
      .where(eq(schema.PlanSubscription.organizationId, id))
      .limit(1)

    const details: OrganizationDetails = {
      id: org.id,
      name: org.name,
      handle: org.handle,
      type: org.type,
      website: org.website,
      createdAt: new Date(org.createdAt),
      updatedAt: new Date(org.updatedAt),
      disabledAt: org.disabledAt ? new Date(org.disabledAt) : null,
      disabledReason: org.disabledReason,
      subscription: subscription
        ? {
            id: subscription.id,
            plan: subscription.plan,
            status: subscription.status,
            billingCycle: subscription.billingCycle,
            seats: subscription.seats,
            creditsBalance: subscription.creditsBalance,
            trialEnd: subscription.trialEnd ? new Date(subscription.trialEnd) : null,
            hasTrialEnded: subscription.hasTrialEnded,
            trialConversionStatus: subscription.trialConversionStatus,
            canceledAt: subscription.canceledAt ? new Date(subscription.canceledAt) : null,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            periodEnd: subscription.periodEnd ? new Date(subscription.periodEnd) : null,
            deletionScheduledDate: subscription.deletionScheduledDate
              ? new Date(subscription.deletionScheduledDate)
              : null,
            deletionReason: subscription.deletionReason,
          }
        : null,
      metrics: {
        userCount: userCountResult?.count ?? 0,
        messageCount: messageCountResult?.count ?? 0,
        ticketCount: ticketCountResult?.count ?? 0,
        workflowCount: workflowCountResult?.count ?? 0,
        datasetCount: datasetCountResult?.count ?? 0,
        documentCount: documentCountResult?.count ?? 0,
        contactCount: contactCountResult?.count ?? 0,
      },
    }

    logger.debug(`Successfully fetched details for organization ${id}`)
    return details
  }

  /**
   * Delete organization - delegates to OrganizationService
   * @param id - Organization ID to delete
   * @returns Success status
   */
  async deleteOrganization(id: string): Promise<void> {
    logger.info(`Admin deletion requested for organization ${id}`)

    await this.organizationService.deleteOrganization({
      organizationId: id,
      isSystemDeletion: true,
      skipEmailConfirmation: true,
    })

    logger.info(`Successfully deleted organization ${id}`)
  }

  /**
   * Get organization members - delegates to MemberService
   * @param organizationId - Organization ID
   * @returns List of organization members with user details
   */
  async getOrganizationMembers(organizationId: string) {
    logger.debug(`Fetching members for organization ${organizationId}`)

    const { MemberService } = await import('../members')
    const memberService = new MemberService(this.db)

    const members = await memberService.getOrganizationMembers(organizationId)

    logger.debug(`Found ${members.length} members for organization ${organizationId}`)
    return members
  }

  /**
   * Get users with aggregated metrics (non-system users only)
   * @param params - Query parameters
   * @param params.limit - Maximum number of results to return
   * @param params.offset - Number of results to skip
   * @param params.search - Search term to filter by name or email
   * @param params.organizationId - Optional organization ID to filter by membership
   * @returns Array of users with metrics
   */
  async getUsers(params: {
    limit?: number
    offset?: number
    search?: string
    organizationId?: string
  }): Promise<UserWithMetrics[]> {
    const { limit = 10, offset = 0, search, organizationId } = params

    logger.debug(
      `Fetching users with limit=${limit}, offset=${offset}, search=${search}, organizationId=${organizationId}`
    )

    // Build WHERE conditions
    const conditions = [eq(schema.User.userType, 'USER')] // CRITICAL: exclude SYSTEM users

    // Add search condition
    if (search) {
      conditions.push(
        or(
          ilike(schema.User.name, `%${search}%`),
          ilike(schema.User.email, `%${search}%`),
          ilike(schema.User.firstName, `%${search}%`),
          ilike(schema.User.lastName, `%${search}%`)
        )!
      )
    }

    // If filtering by organization, join with OrganizationMember
    let users: Array<{
      id: string
      name: string | null
      email: string | null
      firstName: string | null
      lastName: string | null
      emailVerified: boolean
      createdAt: Date | string
      lastActiveAt: Date | string | null
    }>

    if (organizationId) {
      users = await this.db
        .selectDistinct({
          id: schema.User.id,
          name: schema.User.name,
          email: schema.User.email,
          firstName: schema.User.firstName,
          lastName: schema.User.lastName,
          emailVerified: schema.User.emailVerified,
          createdAt: schema.User.createdAt,
          lastActiveAt: schema.User.lastActiveAt,
        })
        .from(schema.User)
        .innerJoin(schema.OrganizationMember, eq(schema.User.id, schema.OrganizationMember.userId))
        .where(
          sql`${schema.User.userType} = 'USER' AND ${schema.OrganizationMember.organizationId} = ${organizationId}${search ? sql` AND (${ilike(schema.User.name, `%${search}%`)} OR ${ilike(schema.User.email, `%${search}%`)} OR ${ilike(schema.User.firstName, `%${search}%`)} OR ${ilike(schema.User.lastName, `%${search}%`)})` : sql``}`
        )
        .orderBy(desc(schema.User.createdAt))
        .limit(limit)
        .offset(offset)
    } else {
      // No org filter - regular query
      users = await this.db
        .select({
          id: schema.User.id,
          name: schema.User.name,
          email: schema.User.email,
          firstName: schema.User.firstName,
          lastName: schema.User.lastName,
          emailVerified: schema.User.emailVerified,
          createdAt: schema.User.createdAt,
          lastActiveAt: schema.User.lastActiveAt,
        })
        .from(schema.User)
        .where(
          sql`${schema.User.userType} = 'USER'${search ? sql` AND (${ilike(schema.User.name, `%${search}%`)} OR ${ilike(schema.User.email, `%${search}%`)} OR ${ilike(schema.User.firstName, `%${search}%`)} OR ${ilike(schema.User.lastName, `%${search}%`)})` : sql``}`
        )
        .orderBy(desc(schema.User.createdAt))
        .limit(limit)
        .offset(offset)
    }

    // Get metrics for each user
    const usersWithMetrics = await Promise.all(
      users.map(async (user) => {
        // Get organization count
        const [orgCountResult] = await this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.OrganizationMember)
          .where(eq(schema.OrganizationMember.userId, user.id))

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          organizationCount: orgCountResult?.count ?? 0,
          emailVerified: user.emailVerified,
          createdAt: new Date(user.createdAt),
          lastActiveAt: user.lastActiveAt ? new Date(user.lastActiveAt) : null,
        }
      })
    )

    logger.debug(`Found ${usersWithMetrics.length} users`)
    return usersWithMetrics
  }

  /**
   * Get single user with detailed stats (non-system users only)
   * @param id - User ID
   * @returns User details with full metrics
   */
  async getUser(id: string): Promise<UserDetails | null> {
    logger.debug(`Fetching user details for ${id}`)

    // Get user
    const [user] = await this.db
      .select()
      .from(schema.User)
      .where(sql`${schema.User.id} = ${id} AND ${schema.User.userType} = 'USER'`)
      .limit(1)

    if (!user) {
      logger.warn(`User ${id} not found or is a system user`)
      return null
    }

    // Get organizations with roles
    const organizations = await this.db
      .select({
        id: schema.Organization.id,
        name: schema.Organization.name,
        handle: schema.Organization.handle,
        role: schema.OrganizationMember.role,
        joinedAt: schema.OrganizationMember.createdAt,
      })
      .from(schema.OrganizationMember)
      .innerJoin(
        schema.Organization,
        eq(schema.OrganizationMember.organizationId, schema.Organization.id)
      )
      .where(eq(schema.OrganizationMember.userId, id))
      .orderBy(desc(schema.OrganizationMember.createdAt))

    // Get organization count
    const [orgCountResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.OrganizationMember)
      .where(eq(schema.OrganizationMember.userId, id))

    // Get message count
    // const [messageCountResult] = await this.db
    //   .select({ count: sql<number>`count(*)::int` })
    //   .from(schema.Message)
    //   .where(eq(schema.Message.userId, id))

    // Get ticket count - count tickets where user created them
    // const [ticketCountResult] = await this.db
    //   .select({ count: sql<number>`count(*)::int` })
    //   .from(schema.Ticket)
    //   .where(eq(schema.Ticket.createdBy, id))

    const details: UserDetails = {
      id: user.id,
      name: user.name,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phoneNumber: user.phoneNumber,
      phoneNumberVerified: user.phoneNumberVerified ?? false,
      emailVerified: user.emailVerified,
      image: user.image,
      about: user.about,
      completedOnboarding: user.completedOnboarding ?? false,
      twoFactorEnabled: user.twoFactorEnabled ?? false,
      isSuperAdmin: user.isSuperAdmin,
      lastActiveAt: user.lastActiveAt ? new Date(user.lastActiveAt) : null,
      createdAt: new Date(user.createdAt),
      updatedAt: new Date(user.updatedAt),
      organizations: organizations.map((org) => ({
        id: org.id,
        name: org.name,
        handle: org.handle,
        role: org.role,
        joinedAt: new Date(org.joinedAt),
      })),
      metrics: {
        organizationCount: orgCountResult?.count ?? 0,
        messageCount: 0,
        ticketCount: 0, //ticketCountResult?.count ?? 0,
      },
    }

    logger.debug(`Successfully fetched details for user ${id}`)
    return details
  }

  /**
   * Update super admin status for a user
   * @param id - User ID
   * @param isSuperAdmin - Desired super admin state
   * @throws Error if user is missing or a system user
   */
  async setUserSuperAdmin(id: string, isSuperAdmin: boolean): Promise<void> {
    logger.info(
      `Admin request to set super admin ${isSuperAdmin ? 'true' : 'false'} for user ${id}`
    )

    const [user] = await this.db
      .select({ userType: schema.User.userType })
      .from(schema.User)
      .where(eq(schema.User.id, id))
      .limit(1)

    if (!user) {
      throw new Error(`User ${id} not found`)
    }

    if (user.userType === 'SYSTEM') {
      throw new Error(`Cannot modify super admin status for system user ${id}`)
    }

    await this.db
      .update(schema.User)
      .set({ isSuperAdmin, updatedAt: new Date() })
      .where(eq(schema.User.id, id))

    logger.info(`Updated super admin status for user ${id}`)
  }

  /**
   * Delete user (non-system users only)
   * @param id - User ID to delete
   * @throws Error if user is a system user or not found
   */
  async deleteUser(id: string): Promise<void> {
    logger.info(`Admin deletion requested for user ${id}`)

    // Verify user exists and is not a system user
    const [user] = await this.db
      .select({ userType: schema.User.userType })
      .from(schema.User)
      .where(eq(schema.User.id, id))
      .limit(1)

    if (!user) {
      throw new Error(`User ${id} not found`)
    }

    if (user.userType === 'SYSTEM') {
      throw new Error(`Cannot delete system user ${id}`)
    }

    // Delete user - cascade deletion will handle related records
    await this.db.delete(schema.User).where(eq(schema.User.id, id))

    logger.info(`Successfully deleted user ${id}`)
  }

  /**
   * Get apps with filters and pagination
   * @param params - Query parameters
   * @param params.limit - Maximum number of results to return (max 100)
   * @param params.offset - Number of results to skip
   * @param params.search - Search term to filter by app title or slug
   * @param params.publicationStatus - Filter by publication status ('unpublished' | 'published')
   * @param params.reviewStatus - Filter by review status
   * @returns Array of apps with metrics
   */
  async getApps(params: {
    limit?: number
    offset?: number
    search?: string
    publicationStatus?: 'unpublished' | 'published'
    reviewStatus?: 'pending-review' | 'in-review' | 'approved' | 'rejected' | 'withdrawn'
  }): Promise<AppWithMetrics[]> {
    const { limit = 100, offset = 0, search, publicationStatus, reviewStatus } = params

    logger.debug(
      `Fetching apps with limit=${limit}, offset=${offset}, search=${search}, publicationStatus=${publicationStatus}, reviewStatus=${reviewStatus}`
    )

    // Build where conditions
    const conditions = []

    if (publicationStatus) {
      conditions.push(eq(schema.App.publicationStatus, publicationStatus))
    }

    if (reviewStatus) {
      conditions.push(eq(schema.App.reviewStatus, reviewStatus))
    }

    if (search) {
      conditions.push(
        or(ilike(schema.App.title, `%${search}%`), ilike(schema.App.slug, `%${search}%`))
      )
    }

    // Query apps with developer account
    const apps = await this.db
      .select({
        id: schema.App.id,
        slug: schema.App.slug,
        title: schema.App.title,
        publicationStatus: schema.App.publicationStatus,
        createdAt: schema.App.createdAt,
        developerAccountId: schema.App.developerAccountId,
        developerAccount: {
          id: schema.DeveloperAccount.id,
          title: schema.DeveloperAccount.title,
          slug: schema.DeveloperAccount.slug,
        },
      })
      .from(schema.App)
      .leftJoin(
        schema.DeveloperAccount,
        eq(schema.App.developerAccountId, schema.DeveloperAccount.id)
      )
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.App.createdAt))
      .limit(limit)
      .offset(offset)

    // For each app, get the latest production version
    const appsWithVersions = await Promise.all(
      apps.map(async (app) => {
        const [latestVersion] = await this.db
          .select({
            major: schema.AppVersion.major,
            minor: schema.AppVersion.minor,
            patch: schema.AppVersion.patch,
          })
          .from(schema.AppVersion)
          .where(
            sql`${schema.AppVersion.appId} = ${app.id} AND ${schema.AppVersion.versionType} = 'prod'`
          )
          .orderBy(
            desc(schema.AppVersion.major),
            desc(schema.AppVersion.minor),
            desc(schema.AppVersion.patch)
          )
          .limit(1)

        return {
          id: app.id,
          slug: app.slug,
          title: app.title,
          publicationStatus: app.publicationStatus,
          createdAt: app.createdAt,
          developerAccount: app.developerAccount,
          latestVersion: latestVersion
            ? `${latestVersion.major}.${latestVersion.minor}.${latestVersion.patch}`
            : null,
        }
      })
    )

    logger.debug(`Found ${appsWithVersions.length} apps`)
    return appsWithVersions
  }

  /**
   * Get single app with all details and versions
   * @param appId - App ID
   * @returns App details with full version list
   * @throws Error if app not found
   */
  async getApp(appId: string): Promise<AppDetails> {
    logger.debug(`Fetching app details for ${appId}`)

    // Get app with all related data using query API
    const app = await this.db.query.App.findFirst({
      where: (apps, { eq }) => eq(apps.id, appId),
      with: {
        developerAccount: {
          columns: {
            id: true,
            title: true,
            slug: true,
          },
        },
        versions: {
          where: (versions, { eq }) => eq(versions.versionType, 'prod'),
          orderBy: (versions, { desc }) => [
            desc(versions.major),
            desc(versions.minor),
            desc(versions.patch),
          ],
          columns: {
            id: true,
            major: true,
            minor: true,
            patch: true,
            publicationStatus: true,
            reviewStatus: true,
            status: true,
            releasedAt: true,
            createdAt: true,
          },
        },
      },
    })

    if (!app) {
      throw new Error('App not found')
    }

    return {
      id: app.id,
      slug: app.slug,
      title: app.title,
      description: app.description,
      category: app.category,
      publicationStatus: app.publicationStatus,
      reviewStatus: app.reviewStatus,
      autoApprove: app.autoApprove,
      websiteUrl: app.websiteUrl,
      documentationUrl: app.documentationUrl,
      supportSiteUrl: app.supportSiteUrl,
      hasOauth: app.hasOauth!,
      hasBundle: app.hasBundle!,
      scopes: (app.scopes as string[]) || [],
      createdAt: app.createdAt,
      updatedAt: app.updatedAt,
      developerAccount: app.developerAccount,
      versions: app.versions.map((v) => ({
        id: v.id,
        versionString: `${v.major}.${v.minor ?? 0}.${v.patch ?? 0}`,
        publicationStatus: v.publicationStatus,
        reviewStatus: v.reviewStatus,
        status: v.status,
        releasedAt: v.releasedAt,
        createdAt: v.createdAt,
      })),
    }
  }

  /**
   * Delete app and all its versions
   * @param appId - App ID
   * @throws Error if app not found
   */
  async deleteApp(appId: string): Promise<void> {
    logger.info(`Admin deletion requested for app ${appId}`)

    // Delete all versions first (cascade)
    await this.db.delete(schema.AppVersion).where(eq(schema.AppVersion.appId, appId))

    // Delete app
    await this.db.delete(schema.App).where(eq(schema.App.id, appId))

    logger.info(`Successfully deleted app ${appId}`)
  }

  /**
   * Toggle auto-approve flag for an app
   * @param appId - App ID
   * @param autoApprove - New auto-approve value
   * @returns Updated app
   * @throws Error if app not found
   */
  async toggleAutoApprove(appId: string, autoApprove: boolean) {
    logger.info(`Admin toggling auto-approve to ${autoApprove} for app ${appId}`)

    const [app] = await this.db
      .update(schema.App)
      .set({
        autoApprove,
        updatedAt: new Date(),
      })
      .where(eq(schema.App.id, appId))
      .returning()

    if (!app) {
      throw new Error('App not found')
    }

    logger.info(`Successfully toggled auto-approve for app ${appId}`)
    return app
  }
}
