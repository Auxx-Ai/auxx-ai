// apps/web/src/components/detail-view/utils.ts

import {
  Box,
  Calendar,
  Clock,
  HouseIcon,
  Layers,
  ListTodo,
  type LucideIcon,
  Mail,
  MessagesSquare,
  Package,
  ReceiptText,
  ShoppingBag,
  Ticket,
  Truck,
} from 'lucide-react'

/**
 * Icon name to component mapping
 */
const ICON_MAP: Record<string, LucideIcon> = {
  house: HouseIcon,
  clock: Clock,
  messages: MessagesSquare,
  'list-todo': ListTodo,
  ticket: Ticket,
  'shopping-bag': ShoppingBag,
  mail: Mail,
  package: Package,
  layers: Layers,
  truck: Truck,
  box: Box,
  'receipt-text': ReceiptText,
  // work_order Schedule section anchor (dispatch M2 build spec §F.2).
  calendar: Calendar,
}

/**
 * Get icon component from icon name string
 * @param iconName - Icon name (e.g., 'ticket', 'clock')
 * @returns Lucide icon component
 */
export function getIconComponent(iconName: string): LucideIcon {
  return ICON_MAP[iconName] ?? Box
}
