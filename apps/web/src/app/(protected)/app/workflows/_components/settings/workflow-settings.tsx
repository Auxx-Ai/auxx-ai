// apps/web/src/app/(protected)/app/workflows/_components/settings/workflow-settings.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Card } from '@auxx/ui/components/card'

interface WorkflowSettingsProps {
  workflow: any
}

export function WorkflowSettings({ workflow }: WorkflowSettingsProps) {
  return (
    <div className="p-6">
      <Card className="p-8 text-center">
        <h3 className="text-lg font-semibold mb-2">Workflow Settings</h3>
        <p className="text-muted-foreground mb-4">
          Configure workflow settings, permissions, and advanced options.
        </p>
        <Badge variant="secondary">Coming Soon</Badge>
      </Card>
    </div>
  )
}
