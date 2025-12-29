// apps/web/src/app/(protected)/app/contacts/_components/groups/customer-groups-card.tsx
import { Plus } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { Badge } from '@auxx/ui/components/badge'

interface CustomerGroupsCardProps {
  customer: any // Replace with proper type
  isMerged: boolean
  onManageGroups: () => void
}

/**
 * CustomerGroupsCard displays the groups a customer belongs to.
 * Header (h4) is rendered by the parent component.
 */
export default function CustomerGroupsCard({
  customer,
  isMerged,
  onManageGroups,
}: CustomerGroupsCardProps) {
  const hasGroups = customer.customerGroups && customer.customerGroups.length > 0

  return (
    <div className="bg-primary-100/50 rounded-2xl border py-2 px-3">
      {hasGroups ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {customer.customerGroups.map((membership: any) => (
              <Badge key={membership.customerGroupId} variant="secondary">
                {membership.customerGroup.name}
              </Badge>
            ))}
          </div>
          {!isMerged && (
            <Button variant="ghost" size="sm" onClick={onManageGroups}>
              <Plus /> Manage Groups
            </Button>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">No groups</span>
          {!isMerged && (
            <Button variant="ghost" size="sm" onClick={onManageGroups}>
              <Plus /> Add to Group
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
