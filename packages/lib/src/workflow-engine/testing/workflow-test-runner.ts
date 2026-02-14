// packages/lib/src/workflow-engine/testing/workflow-test-runner.ts

import { createScopedLogger } from '@auxx/logger'
import type {
  ProcessedMessage,
  Workflow,
  WorkflowExecutionOptions,
  WorkflowExecutionResult,
  WorkflowTriggerEvent,
} from '../core/types'
import { WorkflowEngine } from '../core/workflow-engine'

const logger = createScopedLogger('workflow-test-runner')

/**
 * Test execution result for a single workflow test
 */
export interface WorkflowTestResult {
  testName: string
  workflowId: string
  success: boolean
  executionResult?: WorkflowExecutionResult
  error?: string
  assertions: {
    passed: number
    failed: number
    total: number
    details: Array<{
      assertion: string
      passed: boolean
      expected: any
      actual: any
      error?: string
    }>
  }
  executionTime: number
}

/**
 * Test suite result containing multiple test results
 */
export interface WorkflowTestSuiteResult {
  suiteName: string
  totalTests: number
  passedTests: number
  failedTests: number
  totalExecutionTime: number
  tests: WorkflowTestResult[]
}

/**
 * Test case definition
 */
export interface WorkflowTestCase {
  name: string
  workflow: Workflow
  input: {
    message: Partial<ProcessedMessage>
    variables?: Record<string, any>
    options?: WorkflowExecutionOptions
  }
  assertions: Array<{
    name: string
    check: (result: WorkflowExecutionResult) => boolean | Promise<boolean>
    expected?: any
    description?: string
  }>
}

/**
 * Test runner for workflow execution and validation
 */
export class WorkflowTestRunner {
  private workflowEngine: WorkflowEngine

  constructor() {
    this.workflowEngine = new WorkflowEngine()
  }

  /**
   * Initialize the test runner
   */
  async initialize(): Promise<void> {
    const registry = this.workflowEngine.getNodeRegistry()
    await registry.initializeWithDefaults()
    logger.info('Workflow test runner initialized')
  }

  /**
   * Run a single workflow test case
   */
  async runTest(testCase: WorkflowTestCase): Promise<WorkflowTestResult> {
    const startTime = Date.now()

    logger.info('Running workflow test', {
      testName: testCase.name,
      workflowId: testCase.workflow.id,
    })

    const result: WorkflowTestResult = {
      testName: testCase.name,
      workflowId: testCase.workflow.id,
      success: false,
      assertions: {
        passed: 0,
        failed: 0,
        total: testCase.assertions.length,
        details: [],
      },
      executionTime: 0,
    }

    try {
      // Create mock message
      const mockMessage = this.createMockMessage(testCase.input.message)

      // Create trigger event
      const triggerEvent: WorkflowTriggerEvent = {
        type: testCase.workflow.triggerType as any,
        data: { message: mockMessage },
        timestamp: new Date(),
        organizationId: testCase.workflow.organizationId,
      }

      // Set execution options
      const options: WorkflowExecutionOptions = {
        debug: true,
        variables: testCase.input.variables || {},
        dryRun: false,
        ...testCase.input.options,
      }

      // Execute workflow
      const executionResult = await this.workflowEngine.executeWorkflow(
        testCase.workflow,
        triggerEvent,
        options
      )

      result.executionResult = executionResult

      // Run assertions
      for (const assertion of testCase.assertions) {
        try {
          const assertionResult = await assertion.check(executionResult)

          const assertionDetail = {
            assertion: assertion.name,
            passed: assertionResult,
            expected: assertion.expected,
            actual: this.extractActualValue(executionResult, assertion),
            error: undefined,
          }

          result.assertions.details.push(assertionDetail)

          if (assertionResult) {
            result.assertions.passed++
          } else {
            result.assertions.failed++
          }

          logger.debug('Assertion completed', {
            testName: testCase.name,
            assertion: assertion.name,
            passed: assertionResult,
          })
        } catch (assertionError) {
          const errorMessage =
            assertionError instanceof Error ? assertionError.message : String(assertionError)

          result.assertions.details.push({
            assertion: assertion.name,
            passed: false,
            expected: assertion.expected,
            actual: undefined,
            error: errorMessage,
          })

          result.assertions.failed++

          logger.error('Assertion failed with error', {
            testName: testCase.name,
            assertion: assertion.name,
            error: errorMessage,
          })
        }
      }

      result.success = result.assertions.failed === 0
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      result.error = errorMessage
      result.success = false

      logger.error('Test execution failed', {
        testName: testCase.name,
        error: errorMessage,
      })
    }

    result.executionTime = Date.now() - startTime

    logger.info('Test completed', {
      testName: testCase.name,
      success: result.success,
      executionTime: result.executionTime,
      assertionsPassed: result.assertions.passed,
      assertionsFailed: result.assertions.failed,
    })

    return result
  }

  /**
   * Run a test suite containing multiple test cases
   */
  async runTestSuite(
    suiteName: string,
    testCases: WorkflowTestCase[]
  ): Promise<WorkflowTestSuiteResult> {
    const startTime = Date.now()

    logger.info('Running workflow test suite', {
      suiteName,
      testCount: testCases.length,
    })

    const results: WorkflowTestResult[] = []

    for (const testCase of testCases) {
      const testResult = await this.runTest(testCase)
      results.push(testResult)
    }

    const totalExecutionTime = Date.now() - startTime
    const passedTests = results.filter((r) => r.success).length
    const failedTests = results.filter((r) => !r.success).length

    const suiteResult: WorkflowTestSuiteResult = {
      suiteName,
      totalTests: testCases.length,
      passedTests,
      failedTests,
      totalExecutionTime,
      tests: results,
    }

    logger.info('Test suite completed', {
      suiteName,
      totalTests: suiteResult.totalTests,
      passedTests: suiteResult.passedTests,
      failedTests: suiteResult.failedTests,
      totalExecutionTime: suiteResult.totalExecutionTime,
    })

    return suiteResult
  }

  /**
   * Create common assertion helpers
   */
  static createAssertions() {
    return {
      /**
       * Assert that workflow completed successfully
       */
      workflowCompleted: (result: WorkflowExecutionResult) => {
        return result.status === 'COMPLETED'
      },

      /**
       * Assert that workflow failed
       */
      workflowFailed: (result: WorkflowExecutionResult) => {
        return result.status === 'FAILED'
      },

      /**
       * Assert that a specific node was executed
       */
      nodeExecuted: (nodeId: string) => (result: WorkflowExecutionResult) => {
        return nodeId in result.nodeResults
      },

      /**
       * Assert that a specific node completed successfully
       */
      nodeCompleted: (nodeId: string) => (result: WorkflowExecutionResult) => {
        const nodeResult = result.nodeResults[nodeId]
        return nodeResult && nodeResult.status === 'COMPLETED'
      },

      /**
       * Assert that a variable was set to a specific value
       */
      variableEquals:
        (variableName: string, expectedValue: any) => (result: WorkflowExecutionResult) => {
          return result.context.variables[variableName] === expectedValue
        },

      /**
       * Assert that a specific number of actions were executed
       */
      actionsExecuted: (expectedCount: number) => (result: WorkflowExecutionResult) => {
        const totalActions = Object.values(result.nodeResults)
          .filter((nodeResult) => nodeResult.output?.executedCount)
          .reduce((total, nodeResult) => total + (nodeResult.output.executedCount || 0), 0)
        return totalActions === expectedCount
      },

      /**
       * Assert that execution time was within bounds
       */
      executionTimeWithin: (maxMs: number) => (result: WorkflowExecutionResult) => {
        return result.totalExecutionTime <= maxMs
      },

      /**
       * Assert that no errors occurred
       */
      noErrors: (result: WorkflowExecutionResult) => {
        return !result.error && Object.values(result.nodeResults).every((n) => !n.error)
      },
    }
  }

  /**
   * Create a mock message from partial data
   */
  private createMockMessage(partial: Partial<ProcessedMessage>): ProcessedMessage {
    const defaultMessage: ProcessedMessage = {
      id: 'test-message-id',
      externalId: 'test-external-id',
      externalThreadId: 'test-thread-id',
      threadId: 'test-thread',
      integrationId: 'test-integration',
      integrationType: 'TEST',
      messageType: 'EMAIL',
      isInbound: true,
      isAutoReply: false,
      isFirstInThread: true,
      isAIGenerated: false,
      subject: 'Test Subject',
      textHtml: '<p>Test message body</p>',
      textPlain: 'Test message body',
      internetMessageId: 'test-internet-message-id',
      snippet: 'Test message body',
      keywords: [],
      hasAttachments: false,
      inReplyTo: null,
      references: null,
      isReply: false,
      historyId: null,
      createdTime: new Date(),
      lastModifiedTime: new Date(),
      sentAt: new Date(),
      receivedAt: new Date(),
      threadIndex: null,
      // internetHeaders: [],
      folderId: null,
      emailLabel: 'inbox',
      signatureId: null,
      metadata: {},
      createdById: null,
      organizationId: 'test-org-id',
      fromId: 'test-participant-id',
      replyToId: null,
      participants: [],
      thread: undefined,
      from: {
        id: 'test-participant-id',
        identifier: 'test@example.com',
        identifierType: 'EMAIL',
        name: 'Test User',
        organizationId: 'test-org-id',
        displayName: 'Test User',
        initials: 'TU',
        isSpammer: false,
        contactId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      replyTo: null,
      organization: {
        id: 'test-org-id',
        name: 'Test Organization',
        createdAt: new Date(),
        updatedAt: new Date(),
        createdById: 'test-user-id',
        type: 'TEAM',
        about: null,
        website: null,
        email_domain: null,
      },
    }

    return { ...defaultMessage, ...partial } as ProcessedMessage
  }

  /**
   * Extract actual value for assertion comparison
   */
  private extractActualValue(result: WorkflowExecutionResult, assertion: any): any {
    // This could be enhanced to extract specific values based on assertion type
    if (assertion.name.includes('variable')) {
      return result.context.variables
    }
    if (assertion.name.includes('status')) {
      return result.status
    }
    if (assertion.name.includes('execution')) {
      return result.totalExecutionTime
    }
    return result
  }
}
