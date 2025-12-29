// hooks/use-rule-test-adapter.tsx
'use client'

import { api } from '~/trpc/react'
import { useMemo } from 'react'

interface LegacyTestInput {
  ruleId: string
  email: {
    subject: string
    body: string
    from: string
    to: string
    metadata?: Record<string, any>
  }
  options?: {
    forceEvaluation?: boolean
    dryRun?: boolean
  }
}

interface LegacyTestOutput {
  matched: boolean
  score: number
  executionTime: number
  details: any
  executedActions: string[]
}

/**
 * Adapter hook that maintains backward compatibility with rule.test API
 * while using the enhanced testCase.testSpecificRules endpoint internally
 */
export function useRuleTestAdapter() {
  const testSpecificRules = api.testCase.testSpecificRules.useMutation()

  const adaptedMutation = useMemo(
    () => ({
      mutate: (input: LegacyTestInput) => {
        // Transform input to testSpecificRules format
        const adaptedInput = {
          ruleIds: [input.ruleId],
          testEmail: {
            subject: input.email.subject,
            body: input.email.body,
            fromEmail: input.email.from,
            toEmail: input.email.to,
            metadata: input.email.metadata,
          },
          options: {
            testMode: true, // Always use test mode for UI testing
            enableDetailedLogging: false,
            recordStatistics: false,
            forceEvaluation: input.options?.forceEvaluation,
            dryRun: input.options?.dryRun,
          },
        }

        return testSpecificRules.mutate(adaptedInput)
      },

      mutateAsync: async (input: LegacyTestInput): Promise<LegacyTestOutput> => {
        // Transform input to testSpecificRules format
        const adaptedInput = {
          ruleIds: [input.ruleId],
          testEmail: {
            subject: input.email.subject,
            body: input.email.body,
            fromEmail: input.email.from,
            toEmail: input.email.to,
            metadata: input.email.metadata,
          },
          options: {
            testMode: true,
            enableDetailedLogging: false,
            recordStatistics: false,
            forceEvaluation: input.options?.forceEvaluation,
            dryRun: input.options?.dryRun,
          },
        }

        const result = await testSpecificRules.mutateAsync(adaptedInput)

        // Transform output to legacy format
        const ruleResult = result.results[0]
        if (!ruleResult) {
          throw new Error('No test result returned')
        }

        return {
          matched: ruleResult.matched,
          score: ruleResult.confidence || (ruleResult.matched ? 1 : 0),
          executionTime: ruleResult.executionTime || 0,
          details: {
            reasoning: ruleResult.reasoning,
            actions: ruleResult.actions,
            error: ruleResult.error,
            ruleType: ruleResult.ruleType,
            ruleName: ruleResult.ruleName,
          },
          executedActions: ruleResult.matched
            ? (ruleResult.actions || []).map((a: any) => a.actionType || a.type || 'unknown')
            : [],
        }
      },

      // Forward all other properties from the underlying mutation
      isLoading: testSpecificRules.isLoading,
      isError: testSpecificRules.isError,
      isSuccess: testSpecificRules.isSuccess,
      error: testSpecificRules.error,
      data: testSpecificRules.data,
      reset: testSpecificRules.reset,
      isPending: testSpecificRules.isPending,
      isIdle: testSpecificRules.isIdle,
      status: testSpecificRules.status,
    }),
    [testSpecificRules]
  )

  return adaptedMutation
}

/**
 * Enhanced hook that provides access to both legacy and new functionality
 */
export function useEnhancedRuleTest() {
  const testSpecificRules = api.testCase.testSpecificRules.useMutation()
  const legacyAdapter = useRuleTestAdapter()

  return {
    // Legacy API for backward compatibility
    test: legacyAdapter,

    // Enhanced API for new features
    testMultiple: testSpecificRules,

    // Convenience methods
    testSingle: (ruleId: string, email: any, options?: any) =>
      testSpecificRules.mutateAsync({
        ruleIds: [ruleId],
        testEmail: {
          subject: email.subject,
          body: email.body,
          fromEmail: email.from,
          toEmail: email.to,
          metadata: email.metadata,
        },
        options: {
          testMode: true,
          enableDetailedLogging: true,
          recordStatistics: false,
          ...options,
        },
      }),
  }
}
