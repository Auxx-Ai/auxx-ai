// apps/web/src/components/detail-view/utils.ts

import {
  Box,
  Clock,
  HouseIcon,
  Layers,
  ListTodo,
  type LucideIcon,
  Mail,
  MessagesSquare,
  Package,
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
}

/**
 * Get icon component from icon name string
 * @param iconName - Icon name (e.g., 'ticket', 'clock')
 * @returns Lucide icon component
 */
export function getIconComponent(iconName: string): LucideIcon {
  return ICON_MAP[iconName] ?? Box
}
