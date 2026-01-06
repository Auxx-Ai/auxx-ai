import { Archive, ArrowDown, ArrowRight, ArrowUp, BookDashed, CheckCircle } from 'lucide-react'
import { Badge } from '@auxx/ui/components/badge'
import { titleize } from '@auxx/utils/strings'
import { PRODUDT_STATUS } from '@auxx/database/enums'
export const priorities = [
  { label: 'Low', value: 'low', icon: ArrowDown },
  { label: 'Medium', value: 'medium', icon: ArrowRight },
  { label: 'High', value: 'high', icon: ArrowUp },
]
export const statuses = [
  { value: PRODUDT_STATUS.ACTIVE, label: 'Active', icon: CheckCircle },
  { value: PRODUDT_STATUS.DRAFT, label: 'Draft', icon: BookDashed },
  { value: PRODUDT_STATUS.ARCHIVED, label: 'Archived', icon: Archive },
  // { value: 'in progress', label: 'In Progress', icon: Timer },
  // { value: 'done', label: 'Done', icon: CheckCircle },
  // { value: 'canceled', label: 'Canceled', icon: CircleOff },
]
export const labels = [
  { value: 'bug', label: 'Bug' },
  { value: 'feature', label: 'Feature' },
  { value: 'documentation', label: 'Documentation' },
]
const PRODUCT_STATUS_COLORS = {
  [PRODUDT_STATUS.ACTIVE]: 'green',
  [PRODUDT_STATUS.ARCHIVED]: 'gray',
  [PRODUDT_STATUS.DRAFT]: 'blue',
}
export function getProductStatusBadge(status: PRODUDT_STATUS): React.ReactElement {
  return <Badge variant={PRODUCT_STATUS_COLORS[status]}>{titleize(status)}</Badge>
}
