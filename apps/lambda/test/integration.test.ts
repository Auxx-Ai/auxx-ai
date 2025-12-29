// apps/lambda/test/integration.test.ts

/**
 * Integration tests for server function execution with runtime helpers
 */

import { assertEquals } from 'jsr:@std/assert'
import { executeServerFunction } from '../src/executor.ts'
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
      email: 'alice@example.com',
    },
    app: {
      id: 'app_test789',
      installationId: 'inst_test999',
    },
    fetch: globalThis.fetch,
    env: 'test',
  }
}

Deno.test('Execute bundle with registerSettingsSchema', async () => {
  // Create test bundle that calls registerSettingsSchema
  const bundleCode = `
    const settingsSchema = {
      user: { type: 'string', required: true },
      config: { type: 'object', properties: { enabled: { type: 'boolean' } } }
    }
    registerSettingsSchema(settingsSchema)

    export const stdin_default = async function(moduleHash, args) {
      return {
        success: true,
        message: 'Hello, World!',
        receivedArgs: args
      }
    }
  `

  const context = createTestContext()

  const executionResult = await executeServerFunction({
    bundleCode,
    functionIdentifier: 'test.server',
    functionArgs: JSON.stringify(['arg1', 'arg2']),
    context,
    timeout: 5000,
    memoryLimit: 512,
  })

  // Check execution result
  assertEquals(executionResult.result.success, true)
  assertEquals(executionResult.result.message, 'Hello, World!')
  assertEquals(executionResult.result.receivedArgs, ['arg1', 'arg2'])

  // Check settings schema was registered
  assertEquals(executionResult.metadata?.settingsSchema?.user?.type, 'string')
  assertEquals(executionResult.metadata?.settingsSchema?.config?.type, 'object')
})

Deno.test('Execute bundle with Server SDK getCurrentUser', async () => {
  // Create test bundle that uses Server SDK
  const bundleCode = `
    export const stdin_default = async function(moduleHash, args) {
      // Use Server SDK
      const user = await AUXX_SERVER_SDK.getCurrentUser()

      return {
        userId: user.id,
        userEmail: user.email,
        userName: user.name,
      }
    }
  `

  const context = createTestContext()

  const executionResult = await executeServerFunction({
    bundleCode,
    functionIdentifier: 'test.server',
    functionArgs: JSON.stringify([]),
    context,
    timeout: 5000,
    memoryLimit: 512,
  })

  // Check that user data matches context
  assertEquals(executionResult.result.userId, 'user_test456')
  assertEquals(executionResult.result.userEmail, 'alice@example.com')
  assertEquals(executionResult.result.userName, 'alice') // Email prefix
})

Deno.test('Execute bundle with Server SDK context access', async () => {
  // Create test bundle that accesses __AUXX_SERVER_CONTEXT__
  const bundleCode = `
    export const stdin_default = async function(moduleHash, args) {
      const context = globalThis.__AUXX_SERVER_CONTEXT__

      return {
        organizationId: context.organization.id,
        organizationHandle: context.organization.handle,
        appId: context.app.id,
        env: context.env,
      }
    }
  `

  const context = createTestContext()

  const executionResult = await executeServerFunction({
    bundleCode,
    functionIdentifier: 'test.server',
    functionArgs: JSON.stringify([]),
    context,
    timeout: 5000,
    memoryLimit: 512,
  })

  // Check context values
  assertEquals(executionResult.result.organizationId, 'org_test123')
  assertEquals(executionResult.result.organizationHandle, 'test-org')
  assertEquals(executionResult.result.appId, 'app_test789')
  assertEquals(executionResult.result.env, 'test')
})

Deno.test('Execute bundle that returns complex data', async () => {
  const bundleCode = `
    export const stdin_default = async function(moduleHash, args) {
      return {
        status: 'success',
        data: {
          tickets: [
            { id: 1, subject: 'Test ticket 1' },
            { id: 2, subject: 'Test ticket 2' },
          ],
          totalCount: 2,
        },
        metadata: {
          executedAt: new Date().toISOString(),
        },
      }
    }
  `

  const context = createTestContext()

  const executionResult = await executeServerFunction({
    bundleCode,
    functionIdentifier: 'test.server',
    functionArgs: JSON.stringify([]),
    context,
    timeout: 5000,
    memoryLimit: 512,
  })

  assertEquals(executionResult.result.status, 'success')
  assertEquals(executionResult.result.data.tickets.length, 2)
  assertEquals(executionResult.result.data.totalCount, 2)
})

Deno.test('Execute bundle with registerSettingsSchema and Server SDK', async () => {
  // Test that both features work together
  const bundleCode = `
    // Register settings
    const settingsSchema = { apiKey: { type: 'string', required: true } }
    registerSettingsSchema(settingsSchema)

    export const stdin_default = async function(moduleHash, args) {
      // Use Server SDK
      const user = await AUXX_SERVER_SDK.getCurrentUser()

      return {
        user: {
          id: user.id,
          email: user.email,
        },
        settingsRegistered: true,
      }
    }
  `

  const context = createTestContext()

  const executionResult = await executeServerFunction({
    bundleCode,
    functionIdentifier: 'test.server',
    functionArgs: JSON.stringify([]),
    context,
    timeout: 5000,
    memoryLimit: 512,
  })

  // Check execution result
  assertEquals(executionResult.result.user.id, 'user_test456')
  assertEquals(executionResult.result.settingsRegistered, true)

  // Check settings schema
  assertEquals(executionResult.metadata?.settingsSchema?.apiKey?.type, 'string')
})

Deno.test('Execute bundle that throws error', async () => {
  const bundleCode = `
    export const stdin_default = async function(moduleHash, args) {
      throw new Error('Test error from bundle')
    }
  `

  const context = createTestContext()

  try {
    await executeServerFunction({
      bundleCode,
      functionIdentifier: 'test.server',
      functionArgs: JSON.stringify([]),
      context,
      timeout: 5000,
      memoryLimit: 512,
    })
    throw new Error('Should have thrown')
  } catch (error: any) {
    assertEquals(error.message, 'Test error from bundle')
  }
})

Deno.test('Cleanup is called even when execution fails', async () => {
  const bundleCode = `
    registerSettingsSchema({ test: 'value' })

    export const stdin_default = async function(moduleHash, args) {
      throw new Error('Intentional error')
    }
  `

  const context = createTestContext()

  try {
    await executeServerFunction({
      bundleCode,
      functionIdentifier: 'test.server',
      functionArgs: JSON.stringify([]),
      context,
      timeout: 5000,
      memoryLimit: 512,
    })
  } catch (error: any) {
    // Expected error
  }

  // Verify cleanup happened - globals should be removed
  assertEquals((globalThis as any).AUXX_SERVER_SDK, undefined)
  assertEquals((globalThis as any).registerSettingsSchema, undefined)
  assertEquals((globalThis as any).__AUXX_SERVER_CONTEXT__, undefined)
})

Deno.test('Multiple sequential executions work correctly', async () => {
  const bundleCode = `
    registerSettingsSchema({ test: 'execution' })

    export const stdin_default = async function(moduleHash, args) {
      const user = await AUXX_SERVER_SDK.getCurrentUser()
      return { userId: user.id, iteration: args[0] }
    }
  `

  const context = createTestContext()

  // Execute 3 times sequentially
  for (let i = 0; i < 3; i++) {
    const executionResult = await executeServerFunction({
      bundleCode,
      functionIdentifier: 'test.server',
      functionArgs: JSON.stringify([i]),
      context,
      timeout: 5000,
      memoryLimit: 512,
    })

    assertEquals(executionResult.result.userId, 'user_test456')
    assertEquals(executionResult.result.iteration, i)
    assertEquals(executionResult.metadata?.settingsSchema?.test, 'execution')
  }

  // Verify final cleanup
  assertEquals((globalThis as any).AUXX_SERVER_SDK, undefined)
})
