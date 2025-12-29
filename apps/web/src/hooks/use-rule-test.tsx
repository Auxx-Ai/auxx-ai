// apps/web/src/hooks/use-rule-test.tsx
'use client'

import { useState } from 'react'
import { api } from '~/trpc/react'
import { toast } from 'sonner'

export interface RuleTestResult {
  success: boolean
  ruleId: string
  ruleName: string
  ruleType: string
  mode: 'test' | 'run'
  matched: boolean
  confidence?: number
  reasoning?: string
  actions: any[]
  executedActions: any[]
  message: {
    id: string
    subject: string | null
    from: string
    snippet: string | null
  }
}

export interface UseRuleTestOptions {
  onSuccess?: (result: RuleTestResult) => void
  onError?: (error: string) => void
  showToasts?: boolean
}

export function useRuleTest(options: UseRuleTestOptions = {}) {
  const { onSuccess, onError, showToasts = true } = options
  const [isTestDialogOpen, setIsTestDialogOpen] = useState(false)
  const [lastResult, setLastResult] = useState<RuleTestResult | null>(null)

  const testOnMessageMutation = api.rule.testOnMessage.useMutation({
    onSuccess: (result) => {
      setLastResult(result)

      if (showToasts) {
        if (result.matched) {
          toast.success(
            `Rule "${result.ruleName}" ${result.mode === 'test' ? 'matched' : 'executed'}!`,
            {
              description: `${result.actions.length} action(s) ${result.mode === 'run' ? 'executed' : 'would be executed'}`,
            }
          )
        } else {
          toast.info(`Rule "${result.ruleName}" did not match`, {
            description: result.reasoning || 'No specific reason provided',
          })
        }
      }

      onSuccess?.(result)
    },
    onError: (error) => {
      const errorMessage = error.message || 'Failed to test rule'

      if (showToasts) {
        toast.error('Rule test failed', {
          description: errorMessage,
        })
      }

      onError?.(errorMessage)
    },
  })

  const testRule = async (params: {
    ruleId: string
    messageId: string
    mode?: 'test' | 'run'
    dryRun?: boolean
    recordInHistory?: boolean
  }) => {
    const { ruleId, messageId, mode = 'test', dryRun = true, recordInHistory = true } = params

    return testOnMessageMutation.mutateAsync({
      ruleId,
      messageId,
      mode,
      options: {
        dryRun,
        recordInHistory,
      },
    })
  }

  const runRule = async (params: {
    ruleId: string
    messageId: string
    dryRun?: boolean
    recordInHistory?: boolean
  }) => {
    return testRule({ ...params, mode: 'run' })
  }

  return {
    testRule,
    runRule,
    isLoading: testOnMessageMutation.isPending,
    lastResult,
    isTestDialogOpen,
    setIsTestDialogOpen,
    error: testOnMessageMutation.error,
  }
}
