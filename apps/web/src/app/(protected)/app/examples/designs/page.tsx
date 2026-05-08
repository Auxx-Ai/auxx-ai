// apps/web/src/app/(protected)/app/examples/designs/page.tsx

'use client'

import { AiThinking } from '@auxx/ui/components/ai-thinking'
import {
  Braces,
  Calculator,
  Calendar,
  CalendarClock,
  CaseSensitive,
  CircleUser,
  Clock,
  DollarSign,
  FileText,
  Hash,
  Link,
  Link2,
  List,
  ListChecks,
  type LucideIcon,
  Mail,
  MapPin,
  Phone,
  Tags,
  ToggleLeft,
  Upload,
  User,
} from 'lucide-react'

type FieldBox = {
  type: string
  label: string
  Icon: LucideIcon
  /** Hue used for the colored variant (icon, tile bg, shadow tint) */
  tileClass: string
  iconClass: string
  shadowClass: string
}

const FIELD_BOXES: FieldBox[] = [
  {
    type: 'TEXT',
    label: 'Text',
    Icon: CaseSensitive,
    tileClass: 'bg-blue-500/10',
    iconClass: 'text-blue-500',
    shadowClass: 'shadow-blue-800/10',
  },
  {
    type: 'NAME',
    label: 'Name',
    Icon: User,
    tileClass: 'bg-violet-500/10',
    iconClass: 'text-violet-500',
    shadowClass: 'shadow-violet-800/10',
  },
  {
    type: 'NUMBER',
    label: 'Number',
    Icon: Hash,
    tileClass: 'bg-amber-500/10',
    iconClass: 'text-amber-500',
    shadowClass: 'shadow-amber-800/10',
  },
  {
    type: 'CURRENCY',
    label: 'Currency',
    Icon: DollarSign,
    tileClass: 'bg-emerald-500/10',
    iconClass: 'text-emerald-500',
    shadowClass: 'shadow-emerald-800/10',
  },
  {
    type: 'PHONE_INTL',
    label: 'Phone Number',
    Icon: Phone,
    tileClass: 'bg-teal-500/10',
    iconClass: 'text-teal-500',
    shadowClass: 'shadow-teal-800/10',
  },
  {
    type: 'EMAIL',
    label: 'Email',
    Icon: Mail,
    tileClass: 'bg-sky-500/10',
    iconClass: 'text-sky-500',
    shadowClass: 'shadow-sky-800/10',
  },
  {
    type: 'URL',
    label: 'URL',
    Icon: Link,
    tileClass: 'bg-cyan-500/10',
    iconClass: 'text-cyan-500',
    shadowClass: 'shadow-cyan-800/10',
  },
  {
    type: 'DATE',
    label: 'Date',
    Icon: Calendar,
    tileClass: 'bg-rose-500/10',
    iconClass: 'text-rose-500',
    shadowClass: 'shadow-rose-800/10',
  },
  {
    type: 'DATETIME',
    label: 'Date & Time',
    Icon: CalendarClock,
    tileClass: 'bg-pink-500/10',
    iconClass: 'text-pink-500',
    shadowClass: 'shadow-pink-800/10',
  },
  {
    type: 'TIME',
    label: 'Time',
    Icon: Clock,
    tileClass: 'bg-fuchsia-500/10',
    iconClass: 'text-fuchsia-500',
    shadowClass: 'shadow-fuchsia-800/10',
  },
  {
    type: 'CHECKBOX',
    label: 'Checkbox',
    Icon: ToggleLeft,
    tileClass: 'bg-green-500/10',
    iconClass: 'text-green-500',
    shadowClass: 'shadow-green-800/10',
  },
  {
    type: 'TAGS',
    label: 'Tags',
    Icon: Tags,
    tileClass: 'bg-indigo-500/10',
    iconClass: 'text-indigo-500',
    shadowClass: 'shadow-indigo-800/10',
  },
  {
    type: 'ADDRESS_STRUCT',
    label: 'Address',
    Icon: MapPin,
    tileClass: 'bg-orange-500/10',
    iconClass: 'text-orange-500',
    shadowClass: 'shadow-orange-800/10',
  },
  {
    type: 'SINGLE_SELECT',
    label: 'Select',
    Icon: List,
    tileClass: 'bg-purple-500/10',
    iconClass: 'text-purple-500',
    shadowClass: 'shadow-purple-800/10',
  },
  {
    type: 'MULTI_SELECT',
    label: 'Multi-Select',
    Icon: ListChecks,
    tileClass: 'bg-lime-500/10',
    iconClass: 'text-lime-500',
    shadowClass: 'shadow-lime-800/10',
  },
  {
    type: 'RICH_TEXT',
    label: 'Rich Text',
    Icon: FileText,
    tileClass: 'bg-slate-500/10',
    iconClass: 'text-slate-500',
    shadowClass: 'shadow-slate-800/10',
  },
  {
    type: 'FILE',
    label: 'File Upload',
    Icon: Upload,
    tileClass: 'bg-stone-500/10',
    iconClass: 'text-stone-500',
    shadowClass: 'shadow-stone-800/10',
  },
  {
    type: 'RELATIONSHIP',
    label: 'Relationship',
    Icon: Link2,
    tileClass: 'bg-yellow-500/10',
    iconClass: 'text-yellow-500',
    shadowClass: 'shadow-yellow-800/10',
  },
  {
    type: 'CALC',
    label: 'Calculated',
    Icon: Calculator,
    tileClass: 'bg-red-500/10',
    iconClass: 'text-red-500',
    shadowClass: 'shadow-red-800/10',
  },
  {
    type: 'ACTOR',
    label: 'Actor',
    Icon: CircleUser,
    tileClass: 'bg-neutral-500/10',
    iconClass: 'text-neutral-500',
    shadowClass: 'shadow-neutral-800/10',
  },
  {
    type: 'JSON',
    label: 'JSON',
    Icon: Braces,
    tileClass: 'bg-zinc-500/10',
    iconClass: 'text-zinc-500',
    shadowClass: 'shadow-zinc-800/10',
  },
]

function FieldBoxRow({ box, grayscale }: { box: FieldBox; grayscale: boolean }) {
  const tileClass = grayscale ? 'bg-zinc-500/10' : box.tileClass
  const iconClass = grayscale ? 'text-zinc-500' : box.iconClass
  const shadowClass = grayscale ? 'shadow-zinc-800/10' : box.shadowClass
  return (
    <div
      className={`bg-illustration ring-border-illustration flex items-center gap-1.5 rounded-xl p-1 pr-3 shadow-md ring-1 ${shadowClass}`}>
      <div
        className={`after:border-foreground/5 relative flex size-8 items-center justify-center rounded-lg after:absolute after:inset-0 after:rounded-lg after:border ${tileClass}`}>
        <box.Icon className={`size-4 ${iconClass}`} />
      </div>
      <div className='text-[10px] font-medium'>{box.label}</div>
    </div>
  )
}

export default function DesignsPage() {
  return (
    <div className='container mx-auto py-6 space-y-10 overflow-y-auto'>
      <div className='space-y-2'>
        <h1 className='text-3xl font-bold'>Designs</h1>
        <p className='text-muted-foreground'>Component design previews.</p>
      </div>

      <section className='space-y-6'>
        <div className='space-y-1'>
          <h2 className='text-xl font-semibold'>Custom Field Type Boxes</h2>
          <p className='text-muted-foreground text-sm'>
            Promo-video tiles for each FieldType. Colored on top, grayscale below.
          </p>
        </div>

        <div className='space-y-3'>
          <div className='text-muted-foreground text-xs font-medium uppercase tracking-wide'>
            Colored
          </div>
          <div className='flex flex-wrap gap-3'>
            {FIELD_BOXES.map((box) => (
              <FieldBoxRow key={box.type} box={box} grayscale={false} />
            ))}
          </div>
        </div>

        <div className='space-y-3'>
          <div className='text-muted-foreground text-xs font-medium uppercase tracking-wide'>
            Grayscale
          </div>
          <div className='flex flex-wrap gap-3'>
            {FIELD_BOXES.map((box) => (
              <FieldBoxRow key={box.type} box={box} grayscale={true} />
            ))}
          </div>
        </div>
      </section>

      <div className='flex items-center justify-center py-12'>
        <AiThinking />
      </div>
    </div>
  )
}
