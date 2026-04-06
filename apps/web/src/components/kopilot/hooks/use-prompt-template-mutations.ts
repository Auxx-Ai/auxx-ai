// apps/web/src/components/kopilot/hooks/use-prompt-template-mutations.ts

'use client'

import { toastError } from '@auxx/ui/components/toast'
import { api } from '~/trpc/react'

export function usePromptTemplateMutations() {
  const utils = api.useUtils()

  const invalidate = () => {
    utils.promptTemplate.list.invalidate()
    utils.promptTemplate.listSystem.invalidate()
  }

  const create = api.promptTemplate.create.useMutation({
    onSuccess: invalidate,
    onError: (error) =>
      toastError({ title: 'Failed to create prompt', description: error.message }),
  })

  const update = api.promptTemplate.update.useMutation({
    onSuccess: invalidate,
    onError: (error) =>
      toastError({ title: 'Failed to update prompt', description: error.message }),
  })

  const remove = api.promptTemplate.delete.useMutation({
    onSuccess: invalidate,
    onError: (error) =>
      toastError({ title: 'Failed to delete prompt', description: error.message }),
  })

  const install = api.promptTemplate.install.useMutation({
    onSuccess: invalidate,
    onError: (error) =>
      toastError({ title: 'Failed to install prompt', description: error.message }),
  })

  return { create, update, remove, install }
}
