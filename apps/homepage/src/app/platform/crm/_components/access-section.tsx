// apps/homepage/src/app/platform/crm/_components/access-section.tsx

import { Bot, KeyRound, Layers } from 'lucide-react'
import AccessLensIllustration from './access-lens-illustration'

const capabilities = [
  {
    icon: Layers,
    name: 'Levels, not checkboxes',
    description:
      'Each area of the workspace gets one level — No access, Read, Edit, Full. Set it once on a permission profile, assign the profile to a person or a group, and be done.',
  },
  {
    icon: KeyRound,
    name: 'Share a single record',
    description:
      'One ticket, one company, one dashboard. A direct share raises access on that record alone — it never hands over the object it belongs to, and it can be revoked just as narrowly.',
  },
  {
    icon: Bot,
    name: 'Agents are members too',
    description:
      'Every AI agent has its own profile and its own audit trail. Run one on a colleague’s behalf and their access becomes a ceiling — delegation can narrow what an agent sees, never widen it.',
  },
]

/**
 * The access story — one record resolved differently per viewer — anchored by
 * the redacting record card.
 *
 * Continues `HowItWorksSection`'s `bg-muted/30` band (and its double `border-x`
 * rail) rather than opening a new one: `CrmCenterSection`'s `SectionTopFade`
 * blends from that exact color, so a plain-background section wedged between
 * them would leave the fade fading from nothing. The hatch strip is the
 * page's own section-start marker.
 */
export default function AccessSection() {
  return (
    <section className='relative bg-muted/30'>
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3'>
        <div className='border-x'>
          <div
            aria-hidden
            className='h-3 w-full border-b border-foreground/10 bg-[repeating-linear-gradient(-45deg,var(--color-foreground),var(--color-foreground)_1px,transparent_1px,transparent_4px)] opacity-15'
          />
          <div className='px-6 py-16 md:py-24'>
            <div className='mx-auto max-w-3xl text-center'>
              <div className='mx-auto inline-flex items-center gap-2 rounded-full border border-foreground/10 bg-background/60 px-3 py-1 text-xs'>
                <KeyRound className='size-3.5 text-emerald-500' />
                <span className='text-muted-foreground'>Permissions · Down to the record</span>
              </div>
              <h2 className='mt-6 text-balance text-4xl font-semibold md:text-5xl'>
                Everyone sees the same record.
                <br />
                Nobody sees the same data.
              </h2>
              <p className='mx-auto mt-4 text-balance text-lg text-muted-foreground'>
                Access is resolved per person, per record — from &ldquo;this ticket exists&rdquo;
                all the way to &ldquo;change it and decide who else can.&rdquo; Pick a name to see
                what they get.
              </p>
            </div>

            <div className='mt-14 w-full'>
              <AccessLensIllustration />
            </div>

            <div className='mt-16 grid gap-x-6 gap-y-8 border-t pt-12 sm:grid-cols-3'>
              {capabilities.map((capability) => (
                <div key={capability.name} className='space-y-2'>
                  <div className='flex items-center gap-2'>
                    <capability.icon className='size-4 fill-foreground/10 text-foreground' />
                    <h3 className='text-sm font-medium'>{capability.name}</h3>
                  </div>
                  <p className='text-sm text-muted-foreground'>{capability.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
