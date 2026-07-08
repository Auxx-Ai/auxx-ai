// apps/homepage/src/app/platform/crm/_mocks/entity-canvas.tsx

'use client'

import {
  Barcode,
  Boxes,
  Briefcase,
  Building2,
  CircleDollarSign,
  CircleDot,
  Factory,
  Flag,
  Globe,
  Hash,
  Mail,
  Package,
  Phone,
  ShoppingCart,
  Ticket,
  Truck,
  Type,
  User,
  Users,
} from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { cn } from '~/lib/utils'
import { EntityCard, type EntityCardData } from './entity-card'

const ENTITIES: EntityCardData[] = [
  {
    name: 'Contact',
    badge: 'System',
    color: 'blue',
    icon: Users,
    attrs: [
      { icon: User, label: 'Full name' },
      { icon: Mail, label: 'Email address' },
      { icon: Phone, label: 'Phone' },
    ],
    more: 12,
  },
  {
    name: 'Part',
    badge: 'Custom',
    color: 'amber',
    icon: Package,
    attrs: [
      { icon: Barcode, label: 'Part number' },
      { icon: Factory, label: 'Supplier' },
      { icon: Boxes, label: 'Stock' },
    ],
    more: 6,
  },
  {
    name: 'Ticket',
    badge: 'System',
    color: 'orange',
    icon: Ticket,
    attrs: [
      { icon: Type, label: 'Subject' },
      { icon: CircleDot, label: 'Status' },
      { icon: Flag, label: 'Priority' },
    ],
    more: 14,
  },
  {
    name: 'Company',
    badge: 'System',
    color: 'purple',
    icon: Building2,
    attrs: [
      { icon: Type, label: 'Company name' },
      { icon: Globe, label: 'Domain' },
      { icon: Briefcase, label: 'Industry' },
    ],
    more: 8,
  },
  {
    name: 'Order',
    badge: 'Custom',
    color: 'green',
    icon: ShoppingCart,
    attrs: [
      { icon: Hash, label: 'Order number' },
      { icon: CircleDollarSign, label: 'Total' },
      { icon: Truck, label: 'Fulfillment' },
    ],
    more: 9,
  },
]

/**
 * Fixed-coordinate design space for the desktop canvas. The canvas is a
 * centered 1104px-wide layer (max-w-6xl minus the px-6 gutters), so card
 * positions and SVG connector paths share one stable coordinate system —
 * no measuring needed. Below `lg` the canvas is hidden and
 * `EntityCardsGrid` renders instead.
 */
const CANVAS_W = 1104
const CANVAS_H = 760

/** [x, y] top-left card positions in canvas coordinates, keyed by ENTITIES order. */
const CARD_POS: Array<[number, number]> = [
  [0, 140], // Contact — flanks the headline, left
  [848, 140], // Part — flanks the headline, right
  [112, 480], // Ticket
  [424, 480], // Company
  [736, 480], // Order
]

/**
 * Dotted relationship connectors (rounded orthogonal elbows, Attio-style).
 * Coordinates match `CARD_POS` anchor points; the last path drops from the
 * Company card down into the mock browser rendered below the canvas.
 */
const EDGE_PATHS = [
  // Contact ↓→↓ Ticket
  'M 128 318 V 408 Q 128 418 138 418 H 230 Q 240 418 240 428 V 478',
  // Part ↓←↓ Order
  'M 976 318 V 408 Q 976 418 966 418 H 874 Q 864 418 864 428 V 478',
  // Ticket — Company
  'M 370 568 H 422',
  // Company — Order
  'M 682 568 H 734',
  // Company ↓ into the browser
  'M 552 658 V 760',
]

/** Endpoint dots — start/end of every edge path. */
const EDGE_DOTS: Array<[number, number]> = [
  [128, 318],
  [240, 478],
  [976, 318],
  [864, 478],
  [370, 568],
  [422, 568],
  [682, 568],
  [734, 568],
  [552, 658],
]

/**
 * Desktop (lg+) relationship canvas: five absolutely positioned entity
 * cards connected by dotted SVG paths, overlaying the hero headline area.
 * Render inside a `relative` container; pointer-events are disabled.
 */
export function EntityCanvas({ className }: { className?: string }) {
  const reducedMotion = useReducedMotion()

  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 select-none',
        className
      )}
      style={{ width: CANVAS_W, height: CANVAS_H }}>
      <svg
        className='absolute inset-0 text-foreground/25'
        width={CANVAS_W}
        height={CANVAS_H}
        viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
        fill='none'>
        {EDGE_PATHS.map((d, i) => (
          <motion.path
            key={d}
            d={d}
            stroke='currentColor'
            strokeWidth='1.5'
            strokeLinecap='round'
            strokeDasharray='2 5'
            initial={reducedMotion ? false : { pathLength: 0, opacity: 0 }}
            whileInView={{ pathLength: 1, opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, delay: 0.35 + i * 0.12, ease: 'easeOut' }}
          />
        ))}
        {EDGE_DOTS.map(([cx, cy]) => (
          <motion.circle
            key={`${cx}-${cy}`}
            cx={cx}
            cy={cy}
            r='3'
            className='fill-background stroke-foreground/30'
            strokeWidth='1.5'
            initial={reducedMotion ? false : { opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.3, delay: 0.4 }}
          />
        ))}
      </svg>

      {ENTITIES.map((entity, i) => {
        const [x, y] = CARD_POS[i]
        return (
          <motion.div
            key={entity.name}
            className='absolute'
            style={{ left: x, top: y }}
            initial={reducedMotion ? false : { opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.45, delay: i * 0.08, ease: 'easeOut' }}>
            <EntityCard data={entity} />
          </motion.div>
        )
      })}
    </div>
  )
}

/** Stacked fallback for below `lg` — same five cards, no connector lines. */
export function EntityCardsGrid({ className }: { className?: string }) {
  return (
    <div className={cn('grid gap-4 sm:grid-cols-2', className)}>
      {ENTITIES.map((entity, i) => (
        <div
          key={entity.name}
          className={cn(i === ENTITIES.length - 1 && 'sm:col-span-2 sm:justify-self-center')}>
          <EntityCard
            data={entity}
            className={cn('w-full', i === ENTITIES.length - 1 && 'sm:w-80')}
          />
        </div>
      ))}
    </div>
  )
}
