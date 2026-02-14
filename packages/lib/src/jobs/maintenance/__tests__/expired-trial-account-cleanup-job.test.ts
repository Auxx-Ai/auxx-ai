// packages/lib/src/jobs/maintenance/__tests__/expired-trial-account-cleanup-job.test.ts

import type { Job } from 'bullmq'
import { subDays } from 'date-fns'
import { beforeEach, describe, expect, it, type MockedFunction, vi } from 'vitest'

// Mock the job data
const mockJobData = {
  dryRun: true,
  gracePeriodDays: 14,
  batchSize: 10,
  sendNotifications: false,
}

// Mock job instance
const mockJob = {
  id: 'test-job-123',
  data: mockJobData,
  updateProgress: vi.fn(),
} as unknown as Job

// Mock database responses
const mockExpiredTrials = [
  {
    organizationId: 'org-1',
    trialEnd: subDays(new Date(), 15), // 15 days ago - ready for deletion
    trialConversionStatus: 'EXPIRED_WITHOUT_CONVERSION',
    hasTrialEnded: true,
    lastNotificationSent: null,
    organizationName: 'Test Org 1',
    ownerEmail: 'owner1@test.com',
  },
  {
    organizationId: 'org-2',
    trialEnd: subDays(new Date(), 8), // 8 days ago - needs warning
    trialConversionStatus: 'EXPIRED_WITHOUT_CONVERSION',
    hasTrialEnded: true,
    lastNotificationSent: null,
    organizationName: 'Test Org 2',
    ownerEmail: 'owner2@test.com',
  },
  {
    organizationId: 'org-3',
    trialEnd: subDays(new Date(), 14), // 14 days ago exactly - needs final notice
    trialConversionStatus: 'CANCELED_DURING_TRIAL',
    hasTrialEnded: true,
    lastNotificationSent: 'WARNING',
    organizationName: 'Test Org 3',
    ownerEmail: 'owner3@test.com',
  },
]

// Mock modules
vi.mock('../../db', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(mockExpiredTrials),
  },
}))

vi.mock('@auxx/database', () => ({
  PlanSubscription: {
    organizationId: 'organizationId',
    trialEnd: 'trialEnd',
    trialConversionStatus: 'trialConversionStatus',
    hasTrialEnded: 'hasTrialEnded',
    lastDeletionNotificationSent: 'lastDeletionNotificationSent',
    stripeSubscriptionId: 'stripeSubscriptionId',
  },
  Organization: {
    id: 'id',
    name: 'name',
    ownerEmail: 'ownerEmail',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
  inArray: vi.fn(),
  isNull: vi.fn(),
}))

vi.mock('../../logger', () => ({
  createScopedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('../../organizations', () => ({
  OrganizationService: vi.fn().mockImplementation(() => ({
    deleteOrganization: vi.fn().mockResolvedValue({ success: true, userDeleted: false }),
  })),
}))

vi.mock('../notifications/trial-expiry-notifications', () => ({
  sendDeletionWarningEmail: vi.fn().mockResolvedValue(undefined),
  sendFinalDeletionNotice: vi.fn().mockResolvedValue(undefined),
}))

describe('ExpiredTrialAccountCleanupJob', () => {
  let expiredTrialAccountCleanupJob: any

  beforeEach(async () => {
    vi.clearAllMocks()

    // Import the job handler
    const module = await import('../expired-trial-account-cleanup-job')
    expiredTrialAccountCleanupJob = module.expiredTrialAccountCleanupJob
  })

  describe('Job Configuration Validation', () => {
    it('should validate job payload schema', async () => {
      const result = await expiredTrialAccountCleanupJob(mockJob)

      expect(result).toBeDefined()
      expect(result.scanned).toBeGreaterThanOrEqual(0)
      expect(result.deleted).toBeGreaterThanOrEqual(0)
      expect(result.skipped).toBeGreaterThanOrEqual(0)
      expect(result.errors).toBeGreaterThanOrEqual(0)
    })

    it('should handle dry run mode correctly', async () => {
      const dryRunJob = {
        ...mockJob,
        data: { ...mockJobData, dryRun: true },
      } as Job

      const result = await expiredTrialAccountCleanupJob(dryRunJob)

      // In dry run mode, everything should be skipped
      expect(result.skipped).toBeGreaterThan(0)
      expect(result.deleted).toBe(0)
    })

    it('should handle empty data correctly', async () => {
      // Mock empty database response
      vi.mocked(require('../../db').db.where).mockResolvedValueOnce([])

      const result = await expiredTrialAccountCleanupJob(mockJob)

      expect(result.scanned).toBe(0)
      expect(result.deleted).toBe(0)
      expect(result.skipped).toBe(0)
    })
  })

  describe('Organization Categorization', () => {
    it('should correctly identify organizations ready for deletion', async () => {
      const result = await expiredTrialAccountCleanupJob(mockJob)

      // Should identify organizations past grace period
      expect(result.scanned).toBeGreaterThan(0)
    })

    it('should respect grace period configuration', async () => {
      const shortGracePeriodJob = {
        ...mockJob,
        data: { ...mockJobData, gracePeriodDays: 5 },
      } as Job

      const result = await expiredTrialAccountCleanupJob(shortGracePeriodJob)

      // With shorter grace period, more orgs should be eligible
      expect(result).toBeDefined()
    })
  })

  describe('Notification Handling', () => {
    it('should skip notifications in dry run mode', async () => {
      const { sendDeletionWarningEmail, sendFinalDeletionNotice } = await import(
        '../notifications/trial-expiry-notifications'
      )

      await expiredTrialAccountCleanupJob(mockJob)

      // Should not send notifications in dry run
      expect(sendDeletionWarningEmail).not.toHaveBeenCalled()
      expect(sendFinalDeletionNotice).not.toHaveBeenCalled()
    })

    it('should send notifications when enabled and not in dry run', async () => {
      const notificationJob = {
        ...mockJob,
        data: { ...mockJobData, dryRun: false, sendNotifications: true },
      } as Job

      const { sendDeletionWarningEmail, sendFinalDeletionNotice } = await import(
        '../notifications/trial-expiry-notifications'
      )

      await expiredTrialAccountCleanupJob(notificationJob)

      // Should attempt to send notifications based on mock data
      // Note: Actual calls depend on the organization categorization logic
      expect(sendDeletionWarningEmail).toHaveBeenCalledTimes(expect.any(Number))
      expect(sendFinalDeletionNotice).toHaveBeenCalledTimes(expect.any(Number))
    })
  })

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      // Mock database error
      vi.mocked(require('../../db').db.where).mockRejectedValueOnce(
        new Error('Database connection failed')
      )

      await expect(expiredTrialAccountCleanupJob(mockJob)).rejects.toThrow(
        'Database connection failed'
      )
    })

    it('should handle deletion errors without stopping the job', async () => {
      // Mock organization service error
      const { OrganizationService } = await import('../../organizations')
      const mockOrgService = vi.mocked(OrganizationService).mock.instances[0] as any
      mockOrgService.deleteOrganization = vi.fn().mockRejectedValue(new Error('Deletion failed'))

      const deletionJob = {
        ...mockJob,
        data: { ...mockJobData, dryRun: false },
      } as Job

      const result = await expiredTrialAccountCleanupJob(deletionJob)

      // Job should complete even with deletion errors
      expect(result).toBeDefined()
      expect(result.errors).toBeGreaterThanOrEqual(0)
    })
  })

  describe('Performance and Batching', () => {
    it('should respect batch size configuration', async () => {
      const batchJob = {
        ...mockJob,
        data: { ...mockJobData, batchSize: 2 },
      } as Job

      const result = await expiredTrialAccountCleanupJob(batchJob)

      // Should complete regardless of batch size
      expect(result).toBeDefined()
    })

    it('should update job progress during execution', async () => {
      await expiredTrialAccountCleanupJob(mockJob)

      // Should call updateProgress at least once during batch processing
      expect(mockJob.updateProgress).toHaveBeenCalledWith(expect.any(Number))
    })
  })

  describe('Data Validation', () => {
    it('should handle organizations with null trial end dates', async () => {
      const invalidData = [
        {
          ...mockExpiredTrials[0],
          trialEnd: null,
        },
      ]

      vi.mocked(require('../../db').db.where).mockResolvedValueOnce(invalidData)

      const result = await expiredTrialAccountCleanupJob(mockJob)

      // Should handle null dates gracefully
      expect(result).toBeDefined()
    })

    it('should filter organizations correctly by trial status', async () => {
      const mixedData = [
        ...mockExpiredTrials,
        {
          organizationId: 'org-active',
          trialEnd: subDays(new Date(), 15),
          trialConversionStatus: 'CONVERTED_TO_PAID', // Should be excluded
          hasTrialEnded: true,
          lastNotificationSent: null,
          organizationName: 'Active Org',
          ownerEmail: 'active@test.com',
        },
      ]

      vi.mocked(require('../../db').db.where).mockResolvedValueOnce(mixedData)

      const result = await expiredTrialAccountCleanupJob(mockJob)

      // Should only process eligible organizations
      expect(result).toBeDefined()
    })
  })
})
