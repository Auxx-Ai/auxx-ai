// apps/web/src/components/file-upload/stores/__tests__/session-isolation.test.ts

import { beforeEach, describe, expect, it } from 'vitest'
import type { UploadStore } from '../types'
import { createUploadStore } from '../upload-store'

describe('Session Isolation', () => {
  let store: UploadStore

  beforeEach(() => {
    // Create fresh store for each test
    store = createUploadStore()
  })

  describe('Configuration Isolation', () => {
    it('should maintain separate configurations per session', async () => {
      // Create session 1 with specific config
      const session1Id = await store.createSession({
        entityType: 'MESSAGE',
        validationConfig: {
          maxFiles: 5,
          maxFileSize: 10 * 1024 * 1024, // 10MB
          fileExtensions: ['.pdf', '.doc'],
        },
        behaviorConfig: {
          allowMultiple: true,
          autoStart: false,
        },
      })

      // Create session 2 with different config
      const session2Id = await store.createSession({
        entityType: 'AVATAR',
        validationConfig: {
          maxFiles: 1,
          maxFileSize: 2 * 1024 * 1024, // 2MB
          fileExtensions: ['.jpg', '.png'],
        },
        behaviorConfig: {
          allowMultiple: false,
          autoStart: true,
        },
      })

      // Verify configs are independent
      const session1 = store.sessions[session1Id]
      const session2 = store.sessions[session2Id]

      expect(session1.entityType).toBe('MESSAGE')
      expect(session1.validationConfig?.maxFiles).toBe(5)
      expect(session1.validationConfig?.maxFileSize).toBe(10 * 1024 * 1024)
      expect(session1.behaviorConfig?.allowMultiple).toBe(true)

      expect(session2.entityType).toBe('AVATAR')
      expect(session2.validationConfig?.maxFiles).toBe(1)
      expect(session2.validationConfig?.maxFileSize).toBe(2 * 1024 * 1024)
      expect(session2.behaviorConfig?.allowMultiple).toBe(false)
    })

    it('should not allow invalid entityType="general"', async () => {
      await expect(
        store.createSession({
          entityType: 'general' as any,
          entityId: 'test',
        })
      ).rejects.toThrow('Invalid entityType')
    })
  })

  describe('Validation Isolation', () => {
    it('should validate files using session-specific rules', async () => {
      // Create session with strict validation
      const sessionId = await store.createSession({
        entityType: 'AVATAR',
        validationConfig: {
          maxFiles: 1,
          maxFileSize: 1024 * 1024, // 1MB
          fileExtensions: ['.jpg', '.png'],
        },
      })

      // Create test files
      const validFile = new File(['test'], 'avatar.jpg', { type: 'image/jpeg' })
      const oversizedFile = new File(['x'.repeat(2 * 1024 * 1024)], 'large.jpg', {
        type: 'image/jpeg',
      })
      const wrongTypeFile = new File(['test'], 'document.pdf', { type: 'application/pdf' })

      // Test validation
      const result1 = await store.validateAndAddFiles([validFile], sessionId)
      expect(result1.validFiles).toHaveLength(1)
      expect(result1.errors).toHaveLength(0)

      const result2 = await store.validateAndAddFiles([oversizedFile], sessionId)
      expect(result2.validFiles).toHaveLength(0)
      expect(result2.errors).toHaveLength(1)
      expect(result2.errors[0]).toContain('exceeds maximum')

      const result3 = await store.validateAndAddFiles([wrongTypeFile], sessionId)
      expect(result3.validFiles).toHaveLength(0)
      expect(result3.errors).toHaveLength(1)
      expect(result3.errors[0]).toContain('not allowed')
    })

    it('should enforce maxFiles limit per session', async () => {
      const sessionId = await store.createSession({
        entityType: 'FILE',
        validationConfig: {
          maxFiles: 2,
        },
      })

      const file1 = new File(['test1'], 'file1.txt')
      const file2 = new File(['test2'], 'file2.txt')
      const file3 = new File(['test3'], 'file3.txt')

      // Add first two files - should succeed
      const result1 = await store.addFilesWithValidation([file1, file2], sessionId)
      expect(result1.addedFileIds).toHaveLength(2)
      expect(result1.validationErrors).toHaveLength(0)

      // Try to add third file - should fail
      const result2 = await store.addFilesWithValidation([file3], sessionId)
      expect(result2.addedFileIds).toHaveLength(0)
      expect(result2.validationErrors).toHaveLength(1)
      expect(result2.validationErrors[0]).toContain('Maximum 2 files')
    })
  })

  describe('Callback Isolation', () => {
    it('should trigger session-specific callbacks', async () => {
      let session1CallbackFired = false
      let session2CallbackFired = false

      // Create two sessions with different callbacks
      const session1Id = await store.createSession({
        entityType: 'MESSAGE',
        callbacks: {
          onChange: () => {
            session1CallbackFired = true
          },
        },
      })

      const session2Id = await store.createSession({
        entityType: 'FILE',
        callbacks: {
          onChange: () => {
            session2CallbackFired = true
          },
        },
      })

      // Add files to session 1
      const file1 = new File(['test'], 'file1.txt')
      await store.addFilesWithValidation([file1], session1Id)

      // Only session 1 callback should fire
      expect(session1CallbackFired).toBe(true)
      expect(session2CallbackFired).toBe(false)

      // Reset flags
      session1CallbackFired = false

      // Add files to session 2
      const file2 = new File(['test'], 'file2.txt')
      await store.addFilesWithValidation([file2], session2Id)

      // Only session 2 callback should fire
      expect(session1CallbackFired).toBe(false)
      expect(session2CallbackFired).toBe(true)
    })
  })

  describe('No Global Fallback', () => {
    it('should not fall back to global config in startUpload', async () => {
      // Set global config (deprecated)
      store.setEntityConfig({
        entityType: 'MESSAGE',
        entityId: 'global-id',
      })

      // Try to upload without creating a session
      const result = await store.startUpload()

      // Should fail with no session error
      expect(result.totalFiles).toBe(0)
      expect(store.errors).toHaveLength(1)
      expect(store.errors[0].code).toBe('NO_ACTIVE_SESSION')
      expect(store.errors[0].message).toContain('No active upload session')
    })

    it('should require explicit session creation', async () => {
      // Add files without session
      const file = new File(['test'], 'test.txt')

      // This should fail without a session
      await expect(store.addFilesWithValidation([file])).rejects.toThrow('No session available')
    })
  })

  describe('Concurrent Sessions', () => {
    it('should handle multiple active sessions independently', async () => {
      // Create three sessions with different configs
      const avatarSession = await store.createSession({
        entityType: 'AVATAR',
        validationConfig: { maxFiles: 1, maxFileSize: 2 * 1024 * 1024 },
      })

      const messageSession = await store.createSession({
        entityType: 'MESSAGE',
        validationConfig: { maxFiles: 3, maxFileSize: 1024 * 1024 },
      })

      const fileSession = await store.createSession({
        entityType: 'FILE',
        validationConfig: { maxFiles: 10, maxFileSize: 10 * 1024 * 1024 },
      })

      // Add files to each session
      const avatarFile = new File(['avatar'], 'avatar.jpg')
      const messageFiles = [new File(['msg1'], 'msg1.txt'), new File(['msg2'], 'msg2.txt')]
      const generalFiles = Array.from(
        { length: 5 },
        (_, i) => new File([`file${i}`], `file${i}.txt`)
      )

      await store.addFilesWithValidation([avatarFile], avatarSession)
      await store.addFilesWithValidation(messageFiles, messageSession)
      await store.addFilesWithValidation(generalFiles, fileSession)

      // Verify each session has correct files
      expect(store.sessions[avatarSession].fileIds).toHaveLength(1)
      expect(store.sessions[messageSession].fileIds).toHaveLength(2)
      expect(store.sessions[fileSession].fileIds).toHaveLength(5)

      // Verify file counts don't interfere
      const avatarFiles = store.sessions[avatarSession].fileIds
        .map((id) => store.files[id])
        .filter(Boolean)
      expect(avatarFiles).toHaveLength(1)
      expect(avatarFiles[0].entityType).toBe('AVATAR')
    })
  })
})
