// apps/web/src/components/groups/ui/permissions-panel.tsx
'use client'

import { useGroupPermissions, useMyGroupPermission, useGroupMutations } from '../hooks'
import { canAdminGroup } from '../utils'
import { Button } from '@auxx/ui/components/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { Badge } from '@auxx/ui/components/badge'
import { Trash2 } from 'lucide-react'
import { Skeleton } from '@auxx/ui/components/skeleton'

/** Props for PermissionsPanel component */
interface PermissionsPanelProps {
  /** Group ID */
  groupId: string
}

/**
 * Panel for viewing and managing group permissions
 * Only visible to users with admin permission
 */
export function PermissionsPanel({ groupId }: PermissionsPanelProps) {
  const { data: permissions, isLoading } = useGroupPermissions(groupId)
  const { data: myPermission } = useMyGroupPermission(groupId)
  const { revokePermission } = useGroupMutations()

  // Only show if user has admin permission
  if (!canAdminGroup(myPermission?.permission ?? null)) {
    return null
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-medium">Permissions</h3>
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    )
  }

  if (!permissions || permissions.length === 0) {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-medium">Permissions</h3>
        <p className="text-sm text-muted-foreground">No explicit permissions configured.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-medium">Permissions</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Type</TableHead>
            <TableHead>Grantee</TableHead>
            <TableHead>Permission</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {permissions.map((p) => (
            <TableRow key={p.id}>
              <TableCell>
                <Badge variant="outline">{p.granteeType}</Badge>
              </TableCell>
              <TableCell className="font-medium">{p.granteeId}</TableCell>
              <TableCell>
                <Badge>{p.permission}</Badge>
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() =>
                    revokePermission.mutate({
                      groupId,
                      granteeType: p.granteeType,
                      granteeId: p.granteeId,
                    })
                  }>
                  <Trash2 />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
