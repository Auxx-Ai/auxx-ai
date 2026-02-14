// src/app/(protected)/app/settings/chat/_hooks/use-widget.ts
'use client'

import { type WidgetFormValues, widgetSchema } from '@auxx/lib/widgets/types'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
// import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { api } from '~/trpc/react'

// export type WidgetFormValues = z.infer<typeof widgetFormSchema>
export { widgetSchema, type WidgetFormValues }
export function useWidget(widgetId?: string) {
  const router = useRouter()
  const [domains, setDomains] = useState<string[]>([])

  // Get widget query
  const getWidgetQuery = api.widget.getWidget.useQuery(
    { widgetId: widgetId || '' },
    {
      enabled: !!widgetId,
      onSuccess: (data) => {
        if (data) {
          // Set domains state for UI
          setDomains(data.allowedDomains || [])
        }
      },
    }
  )

  // Save widget mutation
  const saveWidgetMutation = api.widget.saveWidget.useMutation({
    onSuccess: (data) => {
      toastSuccess({ title: 'Chat widget saved successfully' })
      router.refresh()

      // If this is a new widget, redirect to the edit page
      if (!widgetId) {
        router.push(`/app/settings/chat/${data.id}`)
      }
    },
    onError: (error) => {
      toastError({ title: 'Failed to save chat widget', description: error.message })
    },
  })

  // Delete widget mutation
  const deleteWidgetMutation = api.widget.deleteWidget.useMutation({
    onSuccess: () => {
      toastSuccess({ title: 'Chat widget deleted successfully' })
      router.push('/app/settings/chat')
      router.refresh()
    },
    onError: (error) => {
      toastError({ title: 'Failed to delete chat widget', description: error.message })
    },
  })

  // Domain management functions
  const addDomain = (newDomain: string) => {
    if (!newDomain) return

    if (!newDomain.match(/^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/)) {
      toastError({ title: 'Please enter a valid domain name (e.g., example.com)' })
      return
    }

    if (domains.includes(newDomain)) {
      toastError({ title: 'This domain is already in the list' })
      return
    }

    setDomains([...domains, newDomain])
    return true
  }

  const removeDomain = (domain: string) => {
    setDomains(domains.filter((d) => d !== domain))
  }

  const saveWidget = (values: WidgetFormValues) => {
    // Make sure domains are up-to-date
    values.allowedDomains = domains

    saveWidgetMutation.mutate(values)
  }

  const deleteWidget = () => {
    if (!widgetId) return

    deleteWidgetMutation.mutate({ widgetId })
  }

  return {
    widget: getWidgetQuery.data,
    isLoading:
      getWidgetQuery.isLoading || saveWidgetMutation.isPending || deleteWidgetMutation.isPending,
    saveWidget,
    deleteWidget,
    domains,
    addDomain,
    removeDomain,
  }
}
