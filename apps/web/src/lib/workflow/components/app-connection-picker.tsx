// apps/web/src/lib/workflow/components/app-connection-picker.tsx

'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { useEffect, useMemo } from 'react'
import Section from '~/components/workflow/ui/section'
import { api } from '~/trpc/react'

interface AppConnectionPickerProps {
  appId: string
  installationId: string
  connectionId?: string
  onChange: (connectionId: string | undefined) => void
}

/**
 * Picker for selecting an org-scoped connection in workflow blocks/triggers.
 * Auto-selects when exactly one connection exists.
 */
export function AppConnectionPicker({
  appId,
  installationId,
  connectionId,
  onChange,
}: AppConnectionPickerProps) {
  const { data: connections } = api.apps.listConnections.useQuery()

  // Filter to org-scoped connections for this app + installation
  const availableConnections = useMemo(() => {
    if (!connections) return []
    return connections.filter(
      (c) => c.appId === appId && c.appInstallationId === installationId && c.global
    )
  }, [connections, appId, installationId])

  // Auto-select if exactly one connection exists and none is selected
  useEffect(() => {
    if (availableConnections.length === 1 && !connectionId) {
      onChange(availableConnections[0].id)
    }
  }, [availableConnections, connectionId, onChange])

  if (availableConnections.length === 0) {
    return null
  }

  // Don't show picker if only one connection — it's auto-selected
  if (availableConnections.length === 1) {
    return null
  }

  return (
    <Section
      title='Connection'
      collapsible={false}
      className='**:data-slot=section]:pb-0'
      actions={
        <Select value={connectionId || ''} onValueChange={(v) => onChange(v || undefined)}>
          <SelectTrigger size='sm' variant='ghost'>
            <SelectValue placeholder='Select connection...' />
          </SelectTrigger>
          <SelectContent>
            {availableConnections.map((conn) => (
              <SelectItem key={conn.id} value={conn.id}>
                {conn.label || conn.appName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  )
}
