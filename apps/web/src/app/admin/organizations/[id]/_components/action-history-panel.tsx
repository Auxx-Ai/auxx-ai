// apps/web/src/app/admin/organizations/[id]/_components/action-history-panel.tsx
'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { api } from '~/trpc/react'
import { format } from 'date-fns'
import {
  History,
  Clock,
  User,
  FileText,
  ChevronDown,
  ChevronUp,
  Shield,
  DollarSign,
  Settings,
  Ban,
  RefreshCw,
  Crown,
} from 'lucide-react'

interface ActionHistoryPanelProps {
  organizationId: string
}

/**
 * Get icon for action type
 */
const getActionIcon = (actionType: string) => {
  const iconMap: Record<string, any> = {
    END_TRIAL: Clock,
    EXTEND_TRIAL: Clock,
    CONVERT_TRIAL_TO_PAID: DollarSign,
    DISABLE_ORGANIZATION: Ban,
    ENABLE_ORGANIZATION: Shield,
    CANCEL_SCHEDULED_DELETION: RefreshCw,
    CANCEL_SUBSCRIPTION_IMMEDIATELY: Ban,
    REACTIVATE_SUBSCRIPTION: RefreshCw,
    FORCE_STATUS_CHANGE: Settings,
    SET_ENTERPRISE_PLAN: Crown,
    CONFIGURE_CUSTOM_LIMITS: Settings,
    CLEAR_CUSTOM_LIMITS: RefreshCw,
    CREDIT_ADJUSTMENT: DollarSign,
  }
  return iconMap[actionType] || FileText
}

/**
 * Get badge variant for action type
 */
const getActionBadgeVariant = (
  actionType: string
): 'default' | 'secondary' | 'destructive' | 'outline' => {
  if (actionType.includes('DISABLE') || actionType.includes('CANCEL')) {
    return 'destructive'
  }
  if (actionType.includes('ENABLE') || actionType.includes('REACTIVATE')) {
    return 'default'
  }
  if (actionType.includes('ENTERPRISE') || actionType.includes('CREDIT')) {
    return 'secondary'
  }
  return 'outline'
}

/**
 * Format action type for display
 */
const formatActionType = (actionType: string): string => {
  return actionType
    .split('_')
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ')
}

/**
 * Action history panel displaying admin audit logs
 */
export function ActionHistoryPanel({ organizationId }: ActionHistoryPanelProps) {
  const [limit, setLimit] = useState(20)
  const [selectedAction, setSelectedAction] = useState<any>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const { data: history, isLoading } = api.admin.billing.getActionHistory.useQuery({
    organizationId,
    limit,
  })

  /**
   * Toggle expanded state for action
   */
  const toggleExpanded = (id: string) => {
    const newExpanded = new Set(expandedIds)
    if (newExpanded.has(id)) {
      newExpanded.delete(id)
    } else {
      newExpanded.add(id)
    }
    setExpandedIds(newExpanded)
  }

  /**
   * Open details dialog
   */
  const openDetails = (action: any) => {
    setSelectedAction(action)
    setDetailsOpen(true)
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="size-5" />
            Action History
          </CardTitle>
          <CardDescription>Recent admin actions taken on this organization</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    )
  }

  if (!history || history.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="size-5" />
            Action History
          </CardTitle>
          <CardDescription>Recent admin actions taken on this organization</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <History className="size-12 mx-auto mb-3 opacity-50" />
            <p>No admin actions recorded yet</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="size-5" />
            Action History
          </CardTitle>
          <CardDescription>
            {history.length} recent admin action{history.length !== 1 ? 's' : ''} on this
            organization
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {history.map((action: any) => {
            const Icon = getActionIcon(action.actionType)
            const isExpanded = expandedIds.has(action.id)

            return (
              <div
                key={action.id}
                className="border rounded-lg p-4 hover:bg-accent/50 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1">
                    <div className="mt-1">
                      <Icon className="size-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <Badge variant={getActionBadgeVariant(action.actionType)}>
                          {formatActionType(action.actionType)}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(action.createdAt), 'PPP p')}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                        <User className="size-3" />
                        <span>
                          {action.adminUser?.name || action.adminUser?.email || 'Unknown Admin'}
                        </span>
                      </div>

                      {action.reason && (
                        <div className="text-sm mb-2">
                          <span className="font-medium">Reason:</span> {action.reason}
                        </div>
                      )}

                      {isExpanded && (
                        <div className="mt-3 space-y-2 text-sm">
                          {action.details && Object.keys(action.details).length > 0 && (
                            <div>
                              <div className="font-medium text-xs text-muted-foreground mb-1">
                                Details
                              </div>
                              <pre className="bg-muted p-2 rounded text-xs overflow-x-auto">
                                {JSON.stringify(action.details, null, 2)}
                              </pre>
                            </div>
                          )}

                          {action.previousState && Object.keys(action.previousState).length > 0 && (
                            <div>
                              <div className="font-medium text-xs text-muted-foreground mb-1">
                                Previous State
                              </div>
                              <pre className="bg-muted p-2 rounded text-xs overflow-x-auto">
                                {JSON.stringify(action.previousState, null, 2)}
                              </pre>
                            </div>
                          )}

                          {action.newState && Object.keys(action.newState).length > 0 && (
                            <div>
                              <div className="font-medium text-xs text-muted-foreground mb-1">
                                New State
                              </div>
                              <pre className="bg-muted p-2 rounded text-xs overflow-x-auto">
                                {JSON.stringify(action.newState, null, 2)}
                              </pre>
                            </div>
                          )}

                          {action.ipAddress && (
                            <div className="text-xs text-muted-foreground">
                              IP: {action.ipAddress}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleExpanded(action.id)}
                    className="shrink-0">
                    {isExpanded ? (
                      <ChevronUp className="size-4" />
                    ) : (
                      <ChevronDown className="size-4" />
                    )}
                  </Button>
                </div>
              </div>
            )
          })}

          {history.length >= limit && (
            <div className="pt-4 text-center">
              <Button variant="outline" onClick={() => setLimit(limit + 20)}>
                Load More
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Details Dialog */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Action Details</DialogTitle>
            <DialogDescription>Complete information about this admin action</DialogDescription>
          </DialogHeader>
          {selectedAction && (
            <div className="space-y-4">
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1">Action Type</div>
                <Badge variant={getActionBadgeVariant(selectedAction.actionType)}>
                  {formatActionType(selectedAction.actionType)}
                </Badge>
              </div>

              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1">Performed By</div>
                <div>
                  {selectedAction.adminUser?.name || selectedAction.adminUser?.email || 'Unknown'}
                </div>
              </div>

              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1">Date & Time</div>
                <div>{format(new Date(selectedAction.createdAt), 'PPP p')}</div>
              </div>

              {selectedAction.reason && (
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">Reason</div>
                  <div>{selectedAction.reason}</div>
                </div>
              )}

              {selectedAction.details && (
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">Details</div>
                  <pre className="bg-muted p-3 rounded text-xs overflow-x-auto">
                    {JSON.stringify(selectedAction.details, null, 2)}
                  </pre>
                </div>
              )}

              {selectedAction.previousState && (
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">
                    Previous State
                  </div>
                  <pre className="bg-muted p-3 rounded text-xs overflow-x-auto">
                    {JSON.stringify(selectedAction.previousState, null, 2)}
                  </pre>
                </div>
              )}

              {selectedAction.newState && (
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">New State</div>
                  <pre className="bg-muted p-3 rounded text-xs overflow-x-auto">
                    {JSON.stringify(selectedAction.newState, null, 2)}
                  </pre>
                </div>
              )}

              {selectedAction.ipAddress && (
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">IP Address</div>
                  <div className="font-mono text-sm">{selectedAction.ipAddress}</div>
                </div>
              )}

              {selectedAction.userAgent && (
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">User Agent</div>
                  <div className="text-sm text-muted-foreground break-all">
                    {selectedAction.userAgent}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
