// apps/web/src/components/kopilot/hooks/use-prompt-template-mutations.ts

'use client'

import { toastError } from '@auxx/ui/components/toast'
import { api } from '~/trpc/react'

export function usePromptTemplateMutations() {
  const utils = api.useUtils()

  const create = api.promptTemplate.create.useMutation({
    onSuccess: () => utils.promptTemplate.list.invalidate(),
    onError: (error) =>
      toastError({ title: 'Failed to create prompt', description: error.message }),
  })

  const update = api.promptTemplate.update.useMutation({
    onSuccess: () => utils.promptTemplate.list.invalidate(),
    onError: (error) =>
      toastError({ title: 'Failed to update prompt', description: error.message }),
  })

  const remove = api.promptTemplate.delete.useMutation({
    onSuccess: () => utils.promptTemplate.list.invalidate(),
    onError: (error) =>
      toastError({ title: 'Failed to delete prompt', description: error.message }),
  })

  return { create, update, remove }
}
