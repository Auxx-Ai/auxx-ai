// packages/credentials/src/__tests__/credential-service.test.ts

import { beforeAll, describe, expect, it } from 'vitest'
import { CredentialService } from '../service/credential-service'

beforeAll(() => {
  process.env.WORKFLOW_CREDENTIAL_ENCRYPTION_KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'
})

describe('CredentialService', () => {
  describe('encrypt / decrypt', () => {
    it('should encrypt and decrypt data correctly', () => {
      const testData = {
        apiKey: 'test-api-key',
        baseId: 'test-base-id',
      }

      const encrypted = CredentialService.encrypt(testData)
      expect(encrypted).toBeTruthy()
      expect(typeof encrypted).toBe('string')

      const decrypted = CredentialService.decrypt(encrypted)
      expect(decrypted).toEqual(testData)
    })

    it('should handle complex nested data', () => {
      const testData = {
        apiKey: 'test-key-123',
        secret: 'super-secret-value',
        baseUrl: 'https://api.example.com',
        nested: {
          innerKey: 'inner-value',
        },
      }

      const encrypted = CredentialService.encrypt(testData)
      const decrypted = CredentialService.decrypt(encrypted)
      expect(decrypted).toEqual(testData)
    })

    it('should produce different ciphertexts for the same input (random IV)', () => {
      const testData = { apiKey: 'same-key' }

      const encrypted1 = CredentialService.encrypt(testData)
      const encrypted2 = CredentialService.encrypt(testData)

      expect(encrypted1).not.toBe(encrypted2)

      // Both should decrypt to the same value
      expect(CredentialService.decrypt(encrypted1)).toEqual(testData)
      expect(CredentialService.decrypt(encrypted2)).toEqual(testData)
    })

    it('should throw on invalid encrypted data', () => {
      expect(() => {
        CredentialService.decrypt('invalid-encrypted-data')
      }).toThrow('Failed to decrypt credential data')
    })
  })
})
