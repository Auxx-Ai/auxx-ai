// apps/web/src/app/(protected)/app/workflows/_components/overview/workflow-overview.tsx
'use client'

import { formatDistanceToNow } from 'date-fns'
import { Calendar, Activity, Settings, CheckCircle, XCircle } from 'lucide-react'
import { CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Badge } from '@auxx/ui/components/badge'
import { getTriggerInfo } from '../utils/trigger-info'

interface WorkflowOverviewProps {
  workflow: any
}

export function WorkflowOverview({ workflow }: WorkflowOverviewProps) {
  const recentExecutions = workflow.executions?.slice(0, 5) || []
  const totalExecutions = workflow._count?.executions || 0
  const successfulExecutions = recentExecutions.filter((e: any) => e.status === 'SUCCEEDED').length
  const successRate =
    recentExecutions.length > 0
      ? Math.round((successfulExecutions / recentExecutions.length) * 100)
      : 0

  return (
    <div className="h-full flex-1 overflow-y-auto bg-background">
      <div className=" flex flex-col ">
        {/* Basic Info */}
        <div className="grid md:grid-cols-2 border-b ">
          <div className="bg-background hover:bg-primary-50 transition-colors duration-200">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Workflow Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-0">
              <div>
                <label className="text-sm font-medium text-muted-foreground">Name</label>
                <p className="text-lg font-semibold">{workflow.name}</p>
              </div>

              {workflow.description && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Description</label>
                  <p className="text-sm">{workflow.description}</p>
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">Status</span>
                <Badge variant={workflow.enabled ? 'default' : 'secondary'}>
                  {workflow.enabled ? 'Enabled' : 'Disabled'}
                </Badge>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">Trigger</span>
                <Badge variant="outline">{getTriggerInfo(workflow.triggerType).title}</Badge>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">Active Version</span>
                <span className="text-sm">v{workflow.version}</span>
              </div>

              {workflow.workflows && workflow.workflows.length > 1 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Total Versions</span>
                  <span className="text-sm">{workflow.workflows.length}</span>
                </div>
              )}
            </CardContent>
          </div>

          <div className="border-l bg-background hover:bg-primary-50 transition-colors duration-200">
            <CardHeader className="p-3">
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Execution Stats
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-3 pt-0">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">Total Executions</span>
                <span className="text-lg font-semibold">{totalExecutions}</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">Success Rate</span>
                <span className="text-lg font-semibold text-green-600">{successRate}%</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">Last Execution</span>
                <span className="text-sm">
                  {recentExecutions.length > 0
                    ? formatDistanceToNow(new Date(recentExecutions[0].createdAt), {
                        addSuffix: true,
                      })
                    : 'Never'}
                </span>
              </div>
            </CardContent>
          </div>
        </div>

        {/* Metadata */}
        <div className="border-b bg-background hover:bg-primary-50 transition-colors duration-200">
          <CardHeader className="p-3">
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Metadata
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-3 pt-0">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-muted-foreground">Created</label>
                <p className="text-sm">
                  {formatDistanceToNow(new Date(workflow.createdAt), { addSuffix: true })}
                </p>
                {workflow.createdBy && (
                  <p className="text-xs text-muted-foreground">
                    by {workflow.createdBy.name || workflow.createdBy.email}
                  </p>
                )}
              </div>

              <div>
                <label className="text-sm font-medium text-muted-foreground">Last Updated</label>
                <p className="text-sm">
                  {formatDistanceToNow(new Date(workflow.updatedAt), { addSuffix: true })}
                </p>
              </div>
            </div>
          </CardContent>
        </div>

        {/* Recent Executions */}
        {recentExecutions.length > 0 && (
          <div className="border-b bg-background hover:bg-primary-50 transition-colors duration-200">
            <CardHeader className="p-3">
              <CardTitle>Recent Executions</CardTitle>
              <CardDescription>
                Last {recentExecutions.length} execution{recentExecutions.length !== 1 ? 's' : ''}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <div className="space-y-3">
                {recentExecutions.map((execution: any) => (
                  <div
                    key={execution.id}
                    className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-3">
                      {execution.status === 'SUCCEEDED' ? (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                      <div>
                        <p className="text-sm font-medium">
                          {execution.status === 'SUCCEEDED' ? 'Success' : 'Failed'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(execution.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                    </div>

                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">
                        {execution.completedAt
                          ? `${Math.round((new Date(execution.completedAt).getTime() - new Date(execution.createdAt).getTime()) / 1000)}s`
                          : 'N/A'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </div>
        )}

        {/* Version History */}
        {workflow.workflows && workflow.workflows.length > 1 && (
          <div className="bg-background hover:bg-primary-50 transition-colors duration-200">
            <CardHeader>
              <CardTitle>Version History</CardTitle>
              <CardDescription>All workflow versions</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {workflow.workflows.map((version: any) => (
                  <div
                    key={version.id}
                    className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <div>
                        <div className="text-sm font-medium">
                          v{version.version}
                          {version.id === workflow.workflowId && (
                            <Badge variant="default" className="ml-2 text-xs">
                              Active
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(version.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                    </div>

                    <div className="text-right">
                      <Badge variant={version.enabled ? 'default' : 'secondary'}>
                        {version.enabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </div>
        )}
      </div>
    </div>
  )
}
