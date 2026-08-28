// apps/web/src/components/detail-view/utils.ts

import {
  Activity,
  ArrowLeftRight,
  Banknote,
  Box,
  Boxes,
  Calculator,
  Calendar,
  CalendarClock,
  Clock,
  CreditCard,
  FileText,
  Gauge,
  Hammer,
  History,
  HouseIcon,
  Layers,
  Link,
  ListTodo,
  type LucideIcon,
  Mail,
  MapPin,
  MessagesSquare,
  Package,
  Paperclip,
  Plug,
  Receipt,
  ReceiptText,
  ScanSearch,
  ShoppingBag,
  Store,
  Tag,
  Ticket,
  Truck,
  User,
  Users,
  Wrench,
} from 'lucide-react'

/**
 * Icon name to component mapping — the ONE map for every `icon:` string in
 * `drawer-config.ts` and `detail-view-config.ts`, covering main tabs, sidebar
 * tabs, drawer additional tabs AND card section headers.
 *
 * It is one map because it used to be two. `base-entity-drawer.tsx` carried a
 * second, shorter copy that `TabCardSection` resolved CARD icons through, and
 * the two drifted: `store` and `paperclip` were live in the card configs but
 * present only here, so every Vendor and Documents section header silently drew
 * the fallback instead. An unmapped name has no type error and no console
 * warning — it just renders the wrong glyph — so the only real defence is that
 * there is nowhere else to look.
 *
 * Adding an `icon:` to a config means adding the name here in the same change.
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
  // work_order Schedule / Upcoming visits / History section anchors (dispatch M2 build spec §F.2).
  calendar: Calendar,
  'calendar-clock': CalendarClock,
  history: History,
  // work_order Billing section anchor (money plan 10 §E).
  'credit-card': CreditCard,
  'file-text': FileText,
  // Card section headers. Keyed by the card's `value`, so the same card carries
  // the same glyph in the drawer and in the detail page's sidebar.
  activity: Activity,
  'arrow-left-right': ArrowLeftRight,
  banknote: Banknote,
  boxes: Boxes,
  calculator: Calculator,
  gauge: Gauge,
  hammer: Hammer,
  link: Link,
  'map-pin': MapPin,
  paperclip: Paperclip,
  plug: Plug,
  receipt: Receipt,
  'scan-search': ScanSearch,
  store: Store,
  tag: Tag,
  user: User,
  users: Users,
  wrench: Wrench,
}

/**
 * Get icon component from icon name string
 * @param iconName - Icon name (e.g., 'ticket', 'clock')
 * @returns Lucide icon component
 */
export function getIconComponent(iconName: string): LucideIcon {
  return ICON_MAP[iconName] ?? Box
}
