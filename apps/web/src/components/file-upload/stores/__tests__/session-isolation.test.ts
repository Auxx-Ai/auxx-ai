// apps/web/src/components/file-upload/stores/__tests__/session-isolation.test.ts

import { beforeEach, describe, expect, it } from 'vitest'
import { useUploadStore } from '../upload-store'

describe('Session Isolation', () => {
  beforeEach(() => {
    // Reset store state between tests
    useUploadStore.getState().cleanup()
  })

  describe('Configuration Isolation', () => {
    it('should maintain separate configurations per session', async () => {
      const store = useUploadStore.getState()

      // Create session 1 with specific config (MESSAGE is a valid entity type)
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

      // Create session 2 with different config (TICKET is a valid entity type)
      const session2Id = await store.createSession({
        entityType: 'TICKET',
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

      // Re-read state after mutations
      const state = useUploadStore.getState()
      const session1 = state.sessions[session1Id]
      const session2 = state.sessions[session2Id]

      expect(session1.entityType).toBe('MESSAGE')
      expect(session1.validationConfig?.maxFiles).toBe(5)
      expect(session1.validationConfig?.maxFileSize).toBe(10 * 1024 * 1024)
      expect(session1.behaviorConfig?.allowMultiple).toBe(true)

      expect(session2.entityType).toBe('TICKET')
      expect(session2.validationConfig?.maxFiles).toBe(1)
      expect(session2.validationConfig?.maxFileSize).toBe(2 * 1024 * 1024)
      expect(session2.behaviorConfig?.allowMultiple).toBe(false)
    })

    it('should fall back to FILE for invalid entityType', async () => {
      const store = useUploadStore.getState()

      // createSession does not throw - it falls back to 'FILE' with a warning
      const sessionId = await store.createSession({
        entityType: 'invalid_type' as any,
        entityId: 'test',
      })

      const state = useUploadStore.getState()
      expect(state.sessions[sessionId].entityType).toBe('FILE')
    })
  })

  describe('Concurrent Sessions', () => {
    it('should handle multiple active sessions independently', async () => {
      const store = useUploadStore.getState()

      // Create sessions with different valid entity types
      const ticketSession = await store.createSession({
        entityType: 'TICKET',
        validationConfig: { maxFiles: 1, maxFileSize: 2 * 1024 * 1024 },
      })

      const messageSession = await store.createSession({
        entityType: 'MESSAGE',
        validationConfig: { maxFiles: 3, maxFileSize: 1024 * 1024 },
      })

      // Sessions should be independent
      const state = useUploadStore.getState()
      expect(state.sessions[ticketSession]).toBeDefined()
      expect(state.sessions[messageSession]).toBeDefined()
      expect(state.sessions[ticketSession].entityType).toBe('TICKET')
      expect(state.sessions[messageSession].entityType).toBe('MESSAGE')
    })
  })
})
