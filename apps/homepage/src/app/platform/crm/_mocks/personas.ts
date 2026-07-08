// apps/homepage/src/app/platform/crm/_mocks/personas.ts

import {
  Boxes,
  Building2,
  CircleDollarSign,
  CircleDot,
  Clock,
  Cog,
  CreditCard,
  Factory,
  Flag,
  Handshake,
  Hash,
  Layers,
  LifeBuoy,
  type LucideIcon,
  Mail,
  MapPin,
  Package,
  Repeat,
  Rocket,
  ShoppingCart,
  Ticket,
  Type,
  User,
  Users,
} from 'lucide-react'
import type { EntityColor, MockSidebarRecordItem } from '~/app/platform/ai/_mocks'

/** One table cell in a persona's mock records table. */
export type MockCell =
  | { kind: 'text'; label: string; muted?: boolean }
  /** Initials avatar + medium-weight name (contacts, assignees). */
  | { kind: 'name'; label: string }
  /** Colored entity-icon badge + label (companies, parts, ticket titles). */
  | { kind: 'record'; label: string; color: EntityColor; icon: LucideIcon }
  | { kind: 'pill'; label: string; className: string }

export interface MockColumn {
  icon: LucideIcon
  label: string
  /** Column (header + cells) is hidden below this breakpoint. */
  hide?: 'md' | 'lg'
}

export interface PersonaConfig {
  key: 'sales' | 'support' | 'manufacturing'
  chipLabel: string
  chipIcon: LucideIcon
  /** Browser chrome URL pill. */
  url: string
  /** Top-bar page label. */
  pageTitle: string
  /** Top-bar primary button label. */
  newLabel: string
  /** Toolbar view-picker label. */
  viewLabel: string
  activeRecordKey: string
  records: MockSidebarRecordItem[]
  /**
   * Grid templates per breakpoint — column counts must match the visible
   * columns: all base columns, `md:` adds `hide: 'md'`, `lg:` adds `hide: 'lg'`.
   */
  gridCols: string
  columns: MockColumn[]
  rows: MockCell[][]
}

// ---------------------------------------------------------------------------
// Pill palettes (soft tag/status colors matching the real DynamicTable pills)
// ---------------------------------------------------------------------------

const PILL = {
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400',
  green: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  red: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400',
  purple: 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400',
  zinc: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-500/15 dark:text-zinc-400',
} as const

const text = (label: string, muted = false): MockCell => ({ kind: 'text', label, muted })
const name = (label: string): MockCell => ({ kind: 'name', label })
const pill = (label: string, className: string): MockCell => ({ kind: 'pill', label, className })
const company = (label: string): MockCell => ({
  kind: 'record',
  label,
  color: 'purple',
  icon: Building2,
})
const ticket = (label: string): MockCell => ({
  kind: 'record',
  label,
  color: 'orange',
  icon: Ticket,
})
const part = (label: string): MockCell => ({ kind: 'record', label, color: 'amber', icon: Package })
const supplier = (label: string): MockCell => ({
  kind: 'record',
  label,
  color: 'purple',
  icon: Factory,
})

// ---------------------------------------------------------------------------
// Product-led Sales — contacts with plan + MRR
// ---------------------------------------------------------------------------

const SALES_ROWS: Array<[string, string, string, [string, string], string, string]> = [
  [
    'Sarah Martinez',
    'sarah@windmill.co',
    'Windmill Co.',
    ['Scale', PILL.purple],
    '$1,490',
    'Jun 24',
  ],
  ['Justin Jones', 'justin@brightlane.io', 'Brightlane', ['Free', PILL.zinc], '$0', 'Jun 22'],
  ['Emily Garcia', 'emily@harborsupply.com', 'Harbor Supply', ['Pro', PILL.blue], '$490', 'Jun 19'],
  [
    'Michael Williams',
    'michael@oakandiron.com',
    'Oak & Iron',
    ['Pro', PILL.blue],
    '$490',
    'Jun 17',
  ],
  [
    'Rachel Brown',
    'rachel@fernstudio.de',
    'Fern Studio',
    ['Scale', PILL.purple],
    '$1,190',
    'Jun 12',
  ],
  [
    'Joshua Anderson',
    'josh@peakoutfitters.com',
    'Peak Outfitters',
    ['Free', PILL.zinc],
    '$0',
    'Jun 10',
  ],
  ['Stephanie Wilson', 'steph@lumenhome.com', 'Lumen Home', ['Pro', PILL.blue], '$690', 'Jun 8'],
  ['David Jones', 'david@cedarworks.io', 'Cedarworks', ['Trial', PILL.amber], '$0', 'Jun 5'],
  ['Ashley Martinez', 'ashley@tidegoods.com', 'Tide Goods', ['Pro', PILL.blue], '$490', 'Jun 3'],
  [
    'William Rodriguez',
    'will@northloop.co',
    'Northloop',
    ['Scale', PILL.purple],
    '$2,180',
    'May 30',
  ],
  ['Jessica Davis', 'jess@mapleandmain.com', 'Maple & Main', ['Trial', PILL.amber], '$0', 'May 27'],
  ['Liam Harris', 'liam@driftwoodco.com', 'Driftwood Co.', ['Pro', PILL.blue], '$490', 'May 24'],
]

const SALES: PersonaConfig = {
  key: 'sales',
  chipLabel: 'Product-led Sales',
  chipIcon: Rocket,
  url: 'app.auxx.ai/app/contacts',
  pageTitle: 'Contacts',
  newLabel: 'New Contact',
  viewLabel: 'All Contacts',
  activeRecordKey: 'contacts',
  records: [
    { key: 'contacts', label: 'Contacts', icon: Users, entityColor: 'blue' },
    { key: 'companies', label: 'Companies', icon: Building2, entityColor: 'purple' },
    { key: 'deals', label: 'Deals', icon: Handshake, entityColor: 'green' },
    { key: 'subscriptions', label: 'Subscriptions', icon: Repeat, entityColor: 'teal' },
  ],
  gridCols:
    'grid grid-cols-[2rem_minmax(0,1.4fr)_minmax(0,1.3fr)] md:grid-cols-[2rem_minmax(0,1.4fr)_minmax(0,1.3fr)_minmax(0,1fr)_5.5rem] lg:grid-cols-[2rem_minmax(0,1.4fr)_minmax(0,1.3fr)_minmax(0,1fr)_5.5rem_5rem_6rem]',
  columns: [
    { icon: Type, label: 'Name' },
    { icon: Mail, label: 'Email' },
    { icon: Building2, label: 'Company', hide: 'md' },
    { icon: CreditCard, label: 'Plan', hide: 'md' },
    { icon: CircleDollarSign, label: 'MRR', hide: 'lg' },
    { icon: Clock, label: 'Signed up', hide: 'lg' },
  ],
  rows: SALES_ROWS.map(([contact, email, comp, [plan, planClass], mrr, signedUp]) => [
    name(contact),
    text(email, true),
    company(comp),
    pill(plan, planClass),
    text(mrr),
    text(signedUp, true),
  ]),
}

// ---------------------------------------------------------------------------
// Support — tickets like the real /app/tickets view
// ---------------------------------------------------------------------------

const SUPPORT_ROWS: Array<[string, string, [string, string], [string, string], string, string]> = [
  [
    'TKT-0158',
    'Delayed shipment inquiry',
    ['Open', PILL.blue],
    ['Medium', PILL.blue],
    'Mia Chen',
    'Sarah Martinez',
  ],
  [
    'TKT-0159',
    'Payment processing issue',
    ['Resolved', PILL.green],
    ['Medium', PILL.blue],
    'Mia Chen',
    'Justin Jones',
  ],
  [
    'TKT-0163',
    'Request for information',
    ['Closed', PILL.zinc],
    ['Low', PILL.zinc],
    'Jonas Weber',
    'Michael Williams',
  ],
  [
    'TKT-0164',
    'Missing item from order',
    ['In Progress', PILL.amber],
    ['High', PILL.red],
    'Mia Chen',
    'Sarah Martinez',
  ],
  [
    'TKT-0226',
    'Initiate product return',
    ['Resolved', PILL.green],
    ['Medium', PILL.blue],
    'Jonas Weber',
    'Emily Garcia',
  ],
  [
    'TKT-0227',
    'Return request for recent order',
    ['Waiting', PILL.purple],
    ['High', PILL.red],
    'Mia Chen',
    'Rachel Brown',
  ],
  [
    'TKT-0015',
    'Request for information',
    ['Open', PILL.blue],
    ['Low', PILL.zinc],
    'Jonas Weber',
    'Joshua Anderson',
  ],
  [
    'TKT-0014',
    'Question about account features',
    ['In Progress', PILL.amber],
    ['Medium', PILL.blue],
    'Mia Chen',
    'Stephanie Wilson',
  ],
  [
    'TKT-0009',
    'Quality issue with product',
    ['Resolved', PILL.green],
    ['Medium', PILL.blue],
    'Jonas Weber',
    'David Jones',
  ],
  [
    'TKT-0019',
    'Return request for recent order',
    ['Waiting', PILL.purple],
    ['Low', PILL.zinc],
    'Mia Chen',
    'Ashley Martinez',
  ],
  [
    'TKT-0020',
    'Request refund for defective product',
    ['Resolved', PILL.green],
    ['High', PILL.red],
    'Jonas Weber',
    'William Rodriguez',
  ],
  [
    'TKT-0024',
    'Website functionality issue',
    ['Closed', PILL.zinc],
    ['High', PILL.red],
    'Mia Chen',
    'Jessica Davis',
  ],
]

const SUPPORT: PersonaConfig = {
  key: 'support',
  chipLabel: 'Support',
  chipIcon: LifeBuoy,
  url: 'app.auxx.ai/app/tickets',
  pageTitle: 'Support Tickets',
  newLabel: 'New Ticket',
  viewLabel: 'All Tickets',
  activeRecordKey: 'tickets',
  records: [
    { key: 'contacts', label: 'Contacts', icon: Users, entityColor: 'blue' },
    { key: 'tickets', label: 'Tickets', icon: Ticket, entityColor: 'orange' },
    { key: 'companies', label: 'Companies', icon: Building2, entityColor: 'purple' },
    { key: 'orders', label: 'Orders', icon: ShoppingCart, entityColor: 'green' },
  ],
  gridCols:
    'grid grid-cols-[2rem_minmax(0,1.6fr)_6rem] md:grid-cols-[2rem_5rem_minmax(0,1.6fr)_6rem_5.5rem_minmax(0,1fr)] lg:grid-cols-[2rem_5rem_minmax(0,1.6fr)_6rem_5.5rem_minmax(0,1fr)_minmax(0,1fr)]',
  columns: [
    { icon: Hash, label: 'Ticket #', hide: 'md' },
    { icon: Type, label: 'Title' },
    { icon: CircleDot, label: 'Status' },
    { icon: Flag, label: 'Priority', hide: 'md' },
    { icon: User, label: 'Assignee', hide: 'md' },
    { icon: Users, label: 'Contact', hide: 'lg' },
  ],
  rows: SUPPORT_ROWS.map(
    ([id, title, [status, statusClass], [prio, prioClass], assignee, contact]) => [
      text(id, true),
      ticket(title),
      pill(status, statusClass),
      pill(prio, prioClass),
      name(assignee),
      name(contact),
    ]
  ),
}

// ---------------------------------------------------------------------------
// Manufacturing — parts with stock + supplier
// ---------------------------------------------------------------------------

const MFG_ROWS: Array<[string, string, string, [string, string], string, string]> = [
  [
    'PRT-1042',
    'Hex bolt M8 × 40',
    'Steelcore GmbH',
    ['1,240', PILL.green],
    '$0.12',
    'Aisle 3 · Bin 12',
  ],
  [
    'PRT-1044',
    'Bearing 6204-2RS',
    'Roton Bearings',
    ['86', PILL.amber],
    '$2.40',
    'Aisle 1 · Bin 04',
  ],
  [
    'PRT-1051',
    'Drive belt B-1120',
    'Vulcan Rubber',
    ['312', PILL.green],
    '$8.75',
    'Aisle 5 · Bin 22',
  ],
  [
    'PRT-1057',
    'Motor mount bracket',
    'Steelcore GmbH',
    ['12', PILL.red],
    '$14.20',
    'Aisle 2 · Bin 08',
  ],
  ['PRT-1063', 'O-ring 32mm viton', 'SealTech', ['2,050', PILL.green], '$0.34', 'Aisle 4 · Bin 31'],
  [
    'PRT-1071',
    'Stepper motor NEMA 23',
    'Motion Labs',
    ['48', PILL.amber],
    '$28.90',
    'Aisle 2 · Bin 15',
  ],
  [
    'PRT-1078',
    'Limit switch V-156',
    'Elektra Parts',
    ['430', PILL.green],
    '$1.85',
    'Aisle 6 · Bin 02',
  ],
  [
    'PRT-1085',
    'Aluminum plate 5mm',
    'Steelcore GmbH',
    ['9', PILL.red],
    '$22.00',
    'Aisle 7 · Bin 01',
  ],
  [
    'PRT-1091',
    'Gearbox 20:1 worm',
    'Motion Labs',
    ['27', PILL.amber],
    '$64.50',
    'Aisle 2 · Bin 19',
  ],
  ['PRT-1096', 'Coolant pump CP-40', 'FlowTech', ['64', PILL.green], '$38.10', 'Aisle 5 · Bin 07'],
  [
    'PRT-1102',
    'Spindle collet ER32',
    'Precision Tools',
    ['150', PILL.green],
    '$6.20',
    'Aisle 1 · Bin 27',
  ],
  [
    'PRT-1108',
    'Safety relay PNOZ',
    'Elektra Parts',
    ['18', PILL.amber],
    '$92.00',
    'Aisle 6 · Bin 09',
  ],
]

const MANUFACTURING: PersonaConfig = {
  key: 'manufacturing',
  chipLabel: 'Manufacturing',
  chipIcon: Factory,
  url: 'app.auxx.ai/app/parts',
  pageTitle: 'Parts',
  newLabel: 'New Part',
  viewLabel: 'All Parts',
  activeRecordKey: 'parts',
  records: [
    { key: 'parts', label: 'Parts', icon: Package, entityColor: 'amber' },
    { key: 'suppliers', label: 'Suppliers', icon: Factory, entityColor: 'purple' },
    { key: 'orders', label: 'Orders', icon: ShoppingCart, entityColor: 'green' },
    { key: 'machines', label: 'Machines', icon: Cog, entityColor: 'teal' },
    { key: 'boms', label: 'BOMs', icon: Layers, entityColor: 'indigo' },
  ],
  gridCols:
    'grid grid-cols-[2rem_minmax(0,1.5fr)_5rem] md:grid-cols-[2rem_5.5rem_minmax(0,1.5fr)_minmax(0,1fr)_5rem] lg:grid-cols-[2rem_5.5rem_minmax(0,1.5fr)_minmax(0,1fr)_5rem_5.5rem_minmax(0,1fr)]',
  columns: [
    { icon: Hash, label: 'Part #', hide: 'md' },
    { icon: Type, label: 'Name' },
    { icon: Factory, label: 'Supplier', hide: 'md' },
    { icon: Boxes, label: 'Stock' },
    { icon: CircleDollarSign, label: 'Unit cost', hide: 'lg' },
    { icon: MapPin, label: 'Location', hide: 'lg' },
  ],
  rows: MFG_ROWS.map(([id, partName, supp, [stock, stockClass], cost, location]) => [
    text(id, true),
    part(partName),
    supplier(supp),
    pill(stock, stockClass),
    text(cost),
    text(location, true),
  ]),
}

export const PERSONAS: PersonaConfig[] = [SALES, SUPPORT, MANUFACTURING]

/** Persona shown on load. */
export const DEFAULT_PERSONA_KEY: PersonaConfig['key'] = 'support'

/** Initials for `name` cells' avatar chips. */
export function nameInitials(label: string): string {
  return label
    .split(' ')
    .map((word) => word[0])
    .slice(0, 2)
    .join('')
}
