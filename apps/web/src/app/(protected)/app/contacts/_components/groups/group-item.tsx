// ~/components/customers/groups/group-item.tsx
import { Checkbox } from '@auxx/ui/components/checkbox'

interface GroupItemProps {
  group: { id: string; name: string; description?: string }
  isSelected: boolean
  statusText?: string
  onToggle: (checked: boolean) => void
}

export default function GroupItem({ group, isSelected, statusText, onToggle }: GroupItemProps) {
  return (
    <div className="flex items-center justify-between p-3 hover:bg-muted/50">
      <div className="flex-1">
        <p className="text-sm font-medium">{group.name}</p>
        {group.description && <p className="text-xs text-muted-foreground">{group.description}</p>}
        {statusText && <p className="mt-1 text-xs text-blue-600">{statusText}</p>}
      </div>
      <Checkbox checked={isSelected} onCheckedChange={(checked) => onToggle(checked === true)} />
    </div>
  )
}
