import DisplayWrapper from './display-wrapper'
import { usePropertyContext } from '../drawer/property-provider'
import { Badge } from '@auxx/ui/components/badge'

/**
 * DisplayContactGroups component
 * Renders customer groups as badges
 */
export function DisplayContactGroups() {
  const { value } = usePropertyContext()

  // Handle empty groups
  if (!value || !Array.isArray(value) || value.length === 0) {
    return <DisplayWrapper copyValue="No groups">No groups</DisplayWrapper>
  }
  const groups = value.map((group: any) => {
    const groupName =
      typeof group === 'string' ? group : group?.name || group?.customerGroup?.name || 'Unknown'
    const groupId = typeof group === 'string' ? group : group?.id || group?.customerGroupId || group

    return { id: groupId, name: groupName }
  })
  const copyText = groups.map((group) => group.name).join(', ')

  return (
    <DisplayWrapper copyValue={copyText || null}>
      <div className="flex flex-wrap gap-1">
        {groups.map((group) => (
          <Badge key={group.id} variant="secondary" className="text-xs">
            {group.name}
          </Badge>
        ))}
      </div>
    </DisplayWrapper>
  )
}
