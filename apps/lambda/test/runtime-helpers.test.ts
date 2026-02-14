// apps/lambda/test/runtime-helpers.test.ts

/**
 * Unit tests for server runtime helpers
 */

import { assertEquals, assertExists } from 'jsr:@std/assert'
import {
  cleanupServerRuntimeHelpers,
  getRegisteredSettingsSchema,
  injectServerRuntimeHelpers,
  registerSettingsSchema,
  resetSettingsSchema,
} from '../src/runtime-helpers/index.ts'
import type { RuntimeContext } from '../src/types.ts'

/**
 * Helper to create test runtime context
 */
function createTestContext(): RuntimeContext {
  return {
    organization: {
      id: 'org_test123',
      handle: 'test-org',
    },
    user: {
      id: 'user_test456',
      email: 'test@example.com',
    },
    app: {
      id: 'app_test789',
      installationId: 'inst_test999',
    },
    fetch: globalThis.fetch,
    env: 'test',
  }
}

Deno.test('registerSettingsSchema - stores schema', () => {
  const schema = {
    user: { name: 'string' },
    config: { enabled: 'boolean' },
  }

  registerSettingsSchema(schema)
  assertEquals(getRegisteredSettingsSchema(), schema)

  // Cleanup
  resetSettingsSchema()
})

Deno.test('getRegisteredSettingsSchema - returns null when no schema registered', () => {
  resetSettingsSchema()
  assertEquals(getRegisteredSettingsSchema(), null)
})

Deno.test('resetSettingsSchema - clears registered schema', () => {
  const schema = { test: 'value' }
  registerSettingsSchema(schema)
  assertEquals(getRegisteredSettingsSchema(), schema)

  resetSettingsSchema()
  assertEquals(getRegisteredSettingsSchema(), null)
})

Deno.test('injectServerRuntimeHelpers - creates global functions', () => {
  const context = createTestContext()

  injectServerRuntimeHelpers(context)

  // Check that globals are created
  assertEquals(typeof (globalThis as any).registerSettingsSchema, 'function')
  assertExists((globalThis as any).AUXX_SERVER_SDK)
  assertEquals(typeof (globalThis as any).AUXX_SERVER_SDK, 'object')
  assertEquals(typeof (globalThis as any).AUXX_SERVER_SDK.getCurrentUser, 'function')
  assertEquals(typeof (globalThis as any).AUXX_SERVER_SDK.fetch, 'function')
  assertExists((globalThis as any).__AUXX_SERVER_CONTEXT__)
  assertEquals((globalThis as any).__AUXX_SERVER_RUNTIME_VERSION__, '1.0.0')

  // Cleanup
  cleanupServerRuntimeHelpers()
})

Deno.test('cleanupServerRuntimeHelpers - removes globals', () => {
  const context = createTestContext()

  injectServerRuntimeHelpers(context)

  // Verify they exist
  assertExists((globalThis as any).registerSettingsSchema)
  assertExists((globalThis as any).AUXX_SERVER_SDK)

  cleanupServerRuntimeHelpers()

  // Verify they're removed
  assertEquals((globalThis as any).registerSettingsSchema, undefined)
  assertEquals((globalThis as any).AUXX_SERVER_SDK, undefined)
  assertEquals((globalThis as any).__AUXX_SERVER_CONTEXT__, undefined)
  assertEquals((globalThis as any).__AUXX_SERVER_RUNTIME_VERSION__, undefined)
})

Deno.test('cleanupServerRuntimeHelpers - resets settings schema', () => {
  const schema = { test: 'value' }
  registerSettingsSchema(schema)
  assertEquals(getRegisteredSettingsSchema(), schema)

  cleanupServerRuntimeHelpers()
  assertEquals(getRegisteredSettingsSchema(), null)
})

Deno.test('Server SDK - getCurrentUser returns context user', async () => {
  const context = createTestContext()
  injectServerRuntimeHelpers(context)

  const user = await (globalThis as any).AUXX_SERVER_SDK.getCurrentUser()

  assertEquals(user.id, 'user_test456')
  assertEquals(user.email, 'test@example.com')
  assertEquals(user.name, 'test') // Email prefix
  assertEquals(user.avatar, undefined)
  assertEquals(user.role, undefined)

  // Cleanup
  cleanupServerRuntimeHelpers()
})

Deno.test('Server SDK - getApiToken throws not implemented', async () => {
  const context = createTestContext()
  injectServerRuntimeHelpers(context)

  try {
    await (globalThis as any).AUXX_SERVER_SDK.getApiToken()
    throw new Error('Should have thrown')
  } catch (error: any) {
    assertEquals(error.message, 'API tokens not yet implemented')
  }

  // Cleanup
  cleanupServerRuntimeHelpers()
})

Deno.test('Server SDK - query throws not implemented', async () => {
  const context = createTestContext()
  injectServerRuntimeHelpers(context)

  try {
    await (globalThis as any).AUXX_SERVER_SDK.query({ sql: 'SELECT * FROM users' })
    throw new Error('Should have thrown')
  } catch (error: any) {
    assertEquals(error.message, 'Database queries not yet implemented')
  }

  // Cleanup
  cleanupServerRuntimeHelpers()
})

Deno.test('Server SDK - storage.get throws not implemented', async () => {
  const context = createTestContext()
  injectServerRuntimeHelpers(context)

  try {
    await (globalThis as any).AUXX_SERVER_SDK.storage.get('test-key')
    throw new Error('Should have thrown')
  } catch (error: any) {
    assertEquals(error.message, 'Storage not yet implemented')
  }

  // Cleanup
  cleanupServerRuntimeHelpers()
})

Deno.test('Server SDK - storage.set throws not implemented', async () => {
  const context = createTestContext()
  injectServerRuntimeHelpers(context)

  try {
    await (globalThis as any).AUXX_SERVER_SDK.storage.set('test-key', 'test-value')
    throw new Error('Should have thrown')
  } catch (error: any) {
    assertEquals(error.message, 'Storage not yet implemented')
  }

  // Cleanup
  cleanupServerRuntimeHelpers()
})

Deno.test('Server SDK - storage.delete throws not implemented', async () => {
  const context = createTestContext()
  injectServerRuntimeHelpers(context)

  try {
    await (globalThis as any).AUXX_SERVER_SDK.storage.delete('test-key')
    throw new Error('Should have thrown')
  } catch (error: any) {
    assertEquals(error.message, 'Storage not yet implemented')
  }

  // Cleanup
  cleanupServerRuntimeHelpers()
})

Deno.test('Server SDK context is injected correctly', () => {
  const context = createTestContext()
  injectServerRuntimeHelpers(context)

  const injectedContext = (globalThis as any).__AUXX_SERVER_CONTEXT__

  assertEquals(injectedContext.organization.id, 'org_test123')
  assertEquals(injectedContext.organization.handle, 'test-org')
  assertEquals(injectedContext.user.id, 'user_test456')
  assertEquals(injectedContext.user.email, 'test@example.com')
  assertEquals(injectedContext.app.id, 'app_test789')
  assertEquals(injectedContext.app.installationId, 'inst_test999')
  assertEquals(injectedContext.env, 'test')

  // Cleanup
  cleanupServerRuntimeHelpers()
})

Deno.test('Multiple inject/cleanup cycles work correctly', () => {
  const context = createTestContext()

  // First cycle
  injectServerRuntimeHelpers(context)
  assertExists((globalThis as any).AUXX_SERVER_SDK)
  cleanupServerRuntimeHelpers()
  assertEquals((globalThis as any).AUXX_SERVER_SDK, undefined)

  // Second cycle
  injectServerRuntimeHelpers(context)
  assertExists((globalThis as any).AUXX_SERVER_SDK)
  cleanupServerRuntimeHelpers()
  assertEquals((globalThis as any).AUXX_SERVER_SDK, undefined)

  // Third cycle
  injectServerRuntimeHelpers(context)
  assertExists((globalThis as any).AUXX_SERVER_SDK)
  cleanupServerRuntimeHelpers()
  assertEquals((globalThis as any).AUXX_SERVER_SDK, undefined)
})
