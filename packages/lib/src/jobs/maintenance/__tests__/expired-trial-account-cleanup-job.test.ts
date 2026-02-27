// packages/lib/src/jobs/maintenance/__tests__/expired-trial-account-cleanup-job.test.ts

import type { Job } from 'bullmq'
import { subDays } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---- chainable mock for Drizzle query builder ----
// The source uses two query shapes:
//   Main query:  db.select().from().innerJoin().innerJoin().where()
//   Fresh-check: db.select().from().where().limit()
// We wire both paths through the same mock chain.

const mockPrepare = vi.fn().mockReturnValue({ execute: vi.fn().mockResolvedValue([]) })
const mockLimit = vi.fn().mockReturnValue({ prepare: mockPrepare, then: undefined })
const mockFreshCheckWhere = vi.fn().mockReturnValue({ limit: mockLimit })
const mockMainQueryWhere = vi.fn()
const mockInnerJoin2 = vi.fn().mockReturnValue({ where: mockMainQueryWhere })
const mockInnerJoin1 = vi.fn().mockReturnValue({ innerJoin: mockInnerJoin2 })
const mockFrom = vi.fn().mockReturnValue({
  innerJoin: mockInnerJoin1,
  where: mockFreshCheckWhere,
})
const mockSelect = vi.fn().mockReturnValue({ from: mockFrom })

const mockUpdateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet })

const mockDeleteOrganization = vi.fn().mockResolvedValue({ success: true, userDeleted: false })

vi.mock('@auxx/database', () => ({
  database: {
    select: (...args: unknown[]) => mockSelect(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  },
  schema: {
    PlanSubscription: {
      organizationId: 'organizationId',
      trialEnd: 'trialEnd',
      trialConversionStatus: 'trialConversionStatus',
      hasTrialEnded: 'hasTrialEnded',
      lastDeletionNotificationSent: 'lastDeletionNotificationSent',
      lastDeletionNotificationDate: 'lastDeletionNotificationDate',
      stripeSubscriptionId: 'stripeSubscriptionId',
    },
    Organization: {
      id: 'id',
      name: 'name',
      createdById: 'createdById',
    },
    User: {
      id: 'id',
      email: 'email',
    },
  },
  PlanSubscription: {},
  Organization: {},
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
  inArray: vi.fn(),
  isNull: vi.fn(),
  sql: vi.fn().mockImplementation((...args: unknown[]) => ({ sql: args })),
  relations: vi.fn().mockReturnValue({}),
}))

vi.mock('@auxx/config/server', () => ({
  WEBAPP_URL: 'https://app.test.com',
}))

vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

const mockEnqueueEmailJob = vi.fn().mockResolvedValue(undefined)

vi.mock('../../email', () => ({
  enqueueEmailJob: (...args: unknown[]) => mockEnqueueEmailJob(...args),
}))

vi.mock('../../../organizations', () => ({
  OrganizationService: class {
    deleteOrganization(...args: unknown[]) {
      return mockDeleteOrganization(...args)
    }
  },
}))

// ---- helpers ----

function makeJob(overrides: Partial<Job['data']> = {}): Job {
  return {
    id: 'test-job-123',
    data: {
      dryRun: false,
      gracePeriodDays: 14,
      batchSize: 10,
      sendNotifications: true,
      ...overrides,
    },
    updateProgress: vi.fn(),
  } as unknown as Job
}

function buildExpiredTrialRow(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: 'org-1',
    trialEnd: subDays(new Date(), 15),
    trialConversionStatus: 'EXPIRED_WITHOUT_CONVERSION',
    hasTrialEnded: true,
    lastNotificationSent: null,
    organizationName: 'Test Org 1',
    ownerEmail: 'owner1@test.com',
    ...overrides,
  }
}

// ---- tests ----

describe('expiredTrialAccountCleanupJob', () => {
  let expiredTrialAccountCleanupJob: (job: Job) => Promise<{
    scanned: number
    deleted: number
    skipped: number
    errors: number
    notificationsWarning: number
    notificationsFinal: number
  }>

  beforeEach(async () => {
    vi.clearAllMocks()

    // Restore the full chainable mock structure after clearAllMocks
    // wipes all .mockReturnValue() / .mockResolvedValue() setups.
    mockUpdateSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
    mockUpdate.mockReturnValue({ set: mockUpdateSet })

    mockLimit.mockResolvedValue([{ stripeSubscriptionId: null }])
    mockFreshCheckWhere.mockReturnValue({ limit: mockLimit })
    mockMainQueryWhere.mockResolvedValue([])
    mockInnerJoin2.mockReturnValue({ where: mockMainQueryWhere })
    mockInnerJoin1.mockReturnValue({ innerJoin: mockInnerJoin2 })
    mockFrom.mockReturnValue({
      innerJoin: mockInnerJoin1,
      where: mockFreshCheckWhere,
    })
    mockSelect.mockReturnValue({ from: mockFrom })

    mockDeleteOrganization.mockResolvedValue({ success: true, userDeleted: false })

    const mod = await import('../expired-trial-account-cleanup-job')
    expiredTrialAccountCleanupJob = mod.expiredTrialAccountCleanupJob
  })

  // ---------- payload validation ----------

  describe('payload validation', () => {
    it('should apply default values when fields are omitted', async () => {
      const job = { id: 'j1', data: {}, updateProgress: vi.fn() } as unknown as Job

      const stats = await expiredTrialAccountCleanupJob(job)

      expect(stats).toEqual(
        expect.objectContaining({
          scanned: 0,
          deleted: 0,
          skipped: 0,
          errors: 0,
        })
      )
    })

    it('should reject invalid payload values', async () => {
      const job = makeJob({ gracePeriodDays: -1 })

      await expect(expiredTrialAccountCleanupJob(job)).rejects.toThrow()
    })
  })

  // ---------- organization categorization ----------

  describe('organization categorization', () => {
    it('should count organizations ready for deletion (>=14 days expired)', async () => {
      mockMainQueryWhere.mockResolvedValue([
        buildExpiredTrialRow({ organizationId: 'org-old', trialEnd: subDays(new Date(), 15) }),
      ])

      const stats = await expiredTrialAccountCleanupJob(makeJob())

      // 1 deletion-ready org scanned
      expect(stats.scanned).toBe(1)
      expect(stats.deleted).toBe(1)
    })

    it('should categorize organizations needing a warning (7-12 days expired)', async () => {
      mockMainQueryWhere.mockResolvedValue([
        buildExpiredTrialRow({
          organizationId: 'org-warn',
          trialEnd: subDays(new Date(), 8),
          lastNotificationSent: null,
        }),
      ])

      const stats = await expiredTrialAccountCleanupJob(makeJob())

      expect(stats.scanned).toBe(1)
      expect(stats.notificationsWarning).toBe(1)
      expect(stats.deleted).toBe(0)
    })

    it('should categorize organizations needing a final notice (13 days expired)', async () => {
      mockMainQueryWhere.mockResolvedValue([
        buildExpiredTrialRow({
          organizationId: 'org-final',
          trialEnd: subDays(new Date(), 13),
          lastNotificationSent: 'WARNING',
        }),
      ])

      const stats = await expiredTrialAccountCleanupJob(makeJob())

      expect(stats.scanned).toBe(1)
      expect(stats.notificationsFinal).toBe(1)
      expect(stats.deleted).toBe(0)
    })

    it('should skip organizations with null trialEnd', async () => {
      mockMainQueryWhere.mockResolvedValue([
        buildExpiredTrialRow({ organizationId: 'org-null', trialEnd: null }),
      ])

      const stats = await expiredTrialAccountCleanupJob(makeJob())

      // null trialEnd is skipped during categorization, so scanned = 0
      expect(stats.scanned).toBe(0)
      expect(stats.deleted).toBe(0)
    })
  })

  // ---------- dry-run mode ----------

  describe('dry-run mode', () => {
    it('should not delete organizations in dry-run mode', async () => {
      mockMainQueryWhere.mockResolvedValue([
        buildExpiredTrialRow({ trialEnd: subDays(new Date(), 20) }),
      ])

      const stats = await expiredTrialAccountCleanupJob(makeJob({ dryRun: true }))

      expect(stats.deleted).toBe(0)
      expect(stats.skipped).toBe(1)
      expect(mockDeleteOrganization).not.toHaveBeenCalled()
    })

    it('should not send notifications in dry-run mode', async () => {
      mockMainQueryWhere.mockResolvedValue([
        buildExpiredTrialRow({
          organizationId: 'org-warn',
          trialEnd: subDays(new Date(), 8),
          lastNotificationSent: null,
        }),
      ])

      await expiredTrialAccountCleanupJob(makeJob({ dryRun: true }))

      expect(mockEnqueueEmailJob).not.toHaveBeenCalled()
    })
  })

  // ---------- notification handling ----------

  describe('notification handling', () => {
    it('should send warning email with correct parameters', async () => {
      mockMainQueryWhere.mockResolvedValue([
        buildExpiredTrialRow({
          organizationId: 'org-warn',
          organizationName: 'Warn Org',
          ownerEmail: 'warn@test.com',
          trialEnd: subDays(new Date(), 8),
          lastNotificationSent: null,
        }),
      ])

      await expiredTrialAccountCleanupJob(makeJob())

      expect(mockEnqueueEmailJob).toHaveBeenCalledWith(
        'trial-deletion-warning',
        expect.objectContaining({
          recipient: { email: 'warn@test.com' },
          organizationName: 'Warn Org',
          daysUntilDeletion: 7,
          reactivationLink: 'https://app.test.com/subscription/reactivate/org-warn',
          source: 'expired-trial-cleanup',
          organizationId: 'org-warn',
        })
      )
    })

    it('should send final notice email with correct parameters', async () => {
      mockMainQueryWhere.mockResolvedValue([
        buildExpiredTrialRow({
          organizationId: 'org-final',
          organizationName: 'Final Org',
          ownerEmail: 'final@test.com',
          trialEnd: subDays(new Date(), 13),
          lastNotificationSent: 'WARNING',
        }),
      ])

      await expiredTrialAccountCleanupJob(makeJob())

      expect(mockEnqueueEmailJob).toHaveBeenCalledWith(
        'trial-deletion-final',
        expect.objectContaining({
          recipient: { email: 'final@test.com' },
          organizationName: 'Final Org',
          hoursUntilDeletion: 24,
          reactivationLink: 'https://app.test.com/subscription/reactivate/org-final',
          source: 'expired-trial-cleanup',
          organizationId: 'org-final',
        })
      )
    })

    it('should skip notification for organizations with null ownerEmail', async () => {
      mockMainQueryWhere.mockResolvedValue([
        buildExpiredTrialRow({
          organizationId: 'org-noemail',
          trialEnd: subDays(new Date(), 8),
          ownerEmail: null,
          lastNotificationSent: null,
        }),
      ])

      const stats = await expiredTrialAccountCleanupJob(makeJob())

      expect(mockEnqueueEmailJob).not.toHaveBeenCalled()
      expect(stats.skipped).toBe(1)
    })

    it('should not send notifications when sendNotifications is false', async () => {
      mockMainQueryWhere.mockResolvedValue([
        buildExpiredTrialRow({
          organizationId: 'org-warn',
          trialEnd: subDays(new Date(), 8),
          lastNotificationSent: null,
        }),
      ])

      const stats = await expiredTrialAccountCleanupJob(makeJob({ sendNotifications: false }))

      expect(mockEnqueueEmailJob).not.toHaveBeenCalled()
      // Notifications are suppressed but no notification stats incremented
      expect(stats.notificationsWarning).toBe(0)
      expect(stats.notificationsFinal).toBe(0)
    })

    it('should update notification status in database after sending warning', async () => {
      mockMainQueryWhere.mockResolvedValue([
        buildExpiredTrialRow({
          organizationId: 'org-warn',
          trialEnd: subDays(new Date(), 8),
          lastNotificationSent: null,
        }),
      ])

      await expiredTrialAccountCleanupJob(makeJob())

      // db.update should have been called to set lastDeletionNotificationSent
      expect(mockUpdate).toHaveBeenCalled()
    })

    it('should increment errors when email sending fails', async () => {
      mockEnqueueEmailJob.mockRejectedValueOnce(new Error('SMTP failure'))

      mockMainQueryWhere.mockResolvedValue([
        buildExpiredTrialRow({
          organizationId: 'org-warn',
          trialEnd: subDays(new Date(), 8),
          lastNotificationSent: null,
        }),
      ])

      const stats = await expiredTrialAccountCleanupJob(makeJob())

      expect(stats.errors).toBe(1)
      expect(stats.notificationsWarning).toBe(0)
    })
  })

  // ---------- deletion processing ----------

  describe('deletion processing', () => {
    it('should delete organizations past the grace period', async () => {
      mockMainQueryWhere.mockResolvedValue([buildExpiredTrialRow({ organizationId: 'org-delete' })])

      const stats = await expiredTrialAccountCleanupJob(makeJob())

      expect(mockDeleteOrganization).toHaveBeenCalledWith({
        organizationId: 'org-delete',
        skipEmailConfirmation: true,
        isSystemDeletion: true,
      })
      expect(stats.deleted).toBe(1)
    })

    it('should skip deletion if organization was reactivated', async () => {
      mockMainQueryWhere.mockResolvedValue([
        buildExpiredTrialRow({ organizationId: 'org-reactivated' }),
      ])

      // Fresh-check returns an active subscription
      mockLimit.mockResolvedValue([{ stripeSubscriptionId: 'sub_active' }])

      const stats = await expiredTrialAccountCleanupJob(makeJob())

      expect(mockDeleteOrganization).not.toHaveBeenCalled()
      expect(stats.skipped).toBe(1)
    })

    it('should continue processing remaining orgs when one deletion fails', async () => {
      mockMainQueryWhere.mockResolvedValue([
        buildExpiredTrialRow({ organizationId: 'org-fail', trialEnd: subDays(new Date(), 15) }),
        buildExpiredTrialRow({ organizationId: 'org-ok', trialEnd: subDays(new Date(), 16) }),
      ])

      mockDeleteOrganization
        .mockRejectedValueOnce(new Error('Deletion failed'))
        .mockResolvedValueOnce({ success: true, userDeleted: false })

      const stats = await expiredTrialAccountCleanupJob(makeJob())

      expect(stats.errors).toBe(1)
      expect(stats.deleted).toBe(1)
    })
  })

  // ---------- batching and progress ----------

  describe('batching and progress', () => {
    it('should process deletions in batches of configured size', async () => {
      const orgs = Array.from({ length: 5 }, (_, i) =>
        buildExpiredTrialRow({
          organizationId: `org-${i}`,
          trialEnd: subDays(new Date(), 15 + i),
        })
      )
      mockMainQueryWhere.mockResolvedValue(orgs)

      const job = makeJob({ batchSize: 2 })
      const stats = await expiredTrialAccountCleanupJob(job)

      expect(stats.deleted).toBe(5)
      // updateProgress should be called for each batch (ceil(5/2) = 3 batches)
      expect(job.updateProgress).toHaveBeenCalledTimes(3)
    })

    it('should report progress as a percentage', async () => {
      mockMainQueryWhere.mockResolvedValue([
        buildExpiredTrialRow({ organizationId: 'org-1', trialEnd: subDays(new Date(), 15) }),
        buildExpiredTrialRow({ organizationId: 'org-2', trialEnd: subDays(new Date(), 16) }),
      ])

      const job = makeJob({ batchSize: 1 })
      await expiredTrialAccountCleanupJob(job)

      expect(job.updateProgress).toHaveBeenCalledWith(50)
      expect(job.updateProgress).toHaveBeenCalledWith(100)
    })
  })

  // ---------- error handling ----------

  describe('error handling', () => {
    it('should throw when the database query fails', async () => {
      mockMainQueryWhere.mockRejectedValue(new Error('Database connection failed'))

      await expect(expiredTrialAccountCleanupJob(makeJob())).rejects.toThrow(
        'Database connection failed'
      )
    })

    it('should return complete stats on success', async () => {
      mockMainQueryWhere.mockResolvedValue([])

      const stats = await expiredTrialAccountCleanupJob(makeJob())

      expect(stats).toEqual({
        scanned: 0,
        deleted: 0,
        skipped: 0,
        errors: 0,
        notificationsWarning: 0,
        notificationsFinal: 0,
      })
    })
  })
})
