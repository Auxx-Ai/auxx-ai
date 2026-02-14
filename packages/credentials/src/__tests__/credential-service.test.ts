// packages/lib/src/workflow-engine/services/__tests__/credential-service.test.ts

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CredentialService } from '../credential-service'

// Mock database for testing
const mockDb = {
  workflowCredentials: {
    create: async (data: any) => ({
      id: 'test-credential-id',
      ...data.data,
    }),
    findFirst: async (query: any) => ({
      id: 'test-credential-id',
      organizationId: 'test-org-id',
      type: 'test-type',
      name: 'Test Credential',
      encryptedData: 'encrypted-data',
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    findMany: async (query: any) => [
      {
        id: 'test-credential-id',
        name: 'Test Credential',
        type: 'test-type',
        createdAt: new Date(),
        createdBy: { name: 'Test User' },
      },
    ],
    updateMany: async (query: any) => ({ count: 1 }),
    deleteMany: async (query: any) => ({ count: 1 }),
  },
  workflow: {
    findMany: async (query: any) => [],
  },
}

// Mock the db import
jest.mock('@auxx/database', () => ({
  db: mockDb,
}))

describe('CredentialService', () => {
  const testOrganizationId = 'test-org-id'
  const testUserId = 'test-user-id'
  const testCredentialType = 'airtable-api'
  const testCredentialName = 'Test Airtable Account'
  const testCredentialData = {
    apiKey: 'test-api-key',
    baseId: 'test-base-id',
  }

  it('should save and retrieve credentials correctly', async () => {
    // This is a basic integration test to verify the service works
    // Note: In a real test environment, you'd want to use a test database

    console.log('Testing credential encryption/decryption...')

    // Test encryption/decryption directly
    const service = CredentialService as any

    try {
      const encrypted = service.encrypt(testCredentialData)
      expect(encrypted).toBeTruthy()
      expect(typeof encrypted).toBe('string')

      const decrypted = service.decrypt(encrypted)
      expect(decrypted).toEqual(testCredentialData)

      console.log('✓ Encryption/decryption works correctly')
    } catch (error) {
      console.error('✗ Encryption/decryption failed:', error)
      throw error
    }
  })

  it('should handle invalid encrypted data gracefully', async () => {
    const service = CredentialService as any

    expect(() => {
      service.decrypt('invalid-encrypted-data')
    }).toThrow('Failed to decrypt credential data')
  })
})

// Export for manual testing
export const testCredentialService = {
  async testEncryption() {
    const testData = {
      apiKey: 'test-key-123',
      secret: 'super-secret-value',
      baseUrl: 'https://api.example.com',
    }

    console.log('Original data:', testData)

    const service = CredentialService as any
    const encrypted = service.encrypt(testData)
    console.log('Encrypted data:', encrypted)

    const decrypted = service.decrypt(encrypted)
    console.log('Decrypted data:', decrypted)

    console.log('Match:', JSON.stringify(testData) === JSON.stringify(decrypted))

    return {
      original: testData,
      encrypted,
      decrypted,
      match: JSON.stringify(testData) === JSON.stringify(decrypted),
    }
  },
}
