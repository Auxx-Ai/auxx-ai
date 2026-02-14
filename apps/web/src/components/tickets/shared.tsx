import { TicketPriority, TicketType } from '@auxx/database/enums'
import {
  BadgeAlert,
  Book,
  BookX,
  CornerDownLeft,
  HelpCircle,
  MemoryStick,
  Receipt,
  TicketX,
  Truck,
} from 'lucide-react'
export const TicketTypeIcons = {
  [TicketType.GENERAL]: <Book size={16} />,
  [TicketType.MISSING_ITEM]: <BookX size={16} />,
  [TicketType.RETURN]: <CornerDownLeft size={16} />,
  [TicketType.PRODUCT_ISSUE]: <BadgeAlert size={16} />,
  [TicketType.SHIPPING_ISSUE]: <Truck size={16} />,
  [TicketType.REFUND]: <TicketX size={16} />,
  [TicketType.BILLING]: <Receipt size={16} />,
  [TicketType.TECHNICAL]: <MemoryStick size={16} />,
  [TicketType.OTHER]: <HelpCircle size={16} />,
}
export const TicketPriorityColors = {
  [TicketPriority.LOW]: 'text-emerald-600',
  [TicketPriority.MEDIUM]: 'text-amber-500',
  [TicketPriority.HIGH]: 'text-red-500',
  [TicketPriority.URGENT]: 'text-red-500',
}
