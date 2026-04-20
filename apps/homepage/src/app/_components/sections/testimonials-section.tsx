// apps/web/src/app/(website)/_components/sections/testimonials-section.tsx

import { GRADIENT_PALETTES } from '@auxx/ui/components/gradient-palettes'
import { RandomGradient } from '@auxx/ui/components/random-gradient'
import Image from 'next/image'
import { avatars } from '~/app/_components/avatars'

// TESTIMONIALS groups the quotes rendered in the grid.
const TESTIMONIALS = [
  {
    name: 'Karo Topchyan',
    role: 'Lead Growth Engineer, Webcor Craft',
    avatar: avatars.karo,
    testimonial:
      'Auxx.Ai keeps our experimentation pipeline humming. We now launch growth tests twice as fast and always know which ideas are worth scaling.',
  },
  {
    name: 'Kyle Vasa Bertolucci',
    role: 'Director, Webcor Craft',
    avatar: avatars.kyle,
    testimonial:
      'Our team stitched Auxx.Ai into an existing design system in a single sprint. The component analytics make it obvious when a variant is ready for prime time.',
  },
  {
    name: 'Andy Wuscher',
    role: 'PERI Formwork',
    avatar: avatars.vicken,
    testimonial:
      "Reliability was the deciding factor for us. Auxx.Ai's guardrails catch edge cases long before they reach customers, which lets us ship with confidence.",
  },
  {
    name: 'Danielle K.',
    role: 'Operations Manager, Bright Consulting',
    avatar: avatars.danielle,
    testimonial:
      'The Auxx.Ai insights dashboard saves us hours every launch. We can see the impact of a rollout in real time and pivot without waiting on manual reports.',
  },
  {
    name: 'Adriana Jauregui',
    role: 'Legacy CivilWorks',
    avatar: avatars.adriana,
    testimonial:
      'Watching teams unlock cleaner experiments and faster delivery with Auxx.Ai is the best validation that we built the right platform.',
  },
  {
    name: 'Lutz Klooth',
    role: 'Founder, Auxx-Lift',
    avatar: avatars.markus,
    testimonial:
      "Auxx.Ai's component inventory keeps our UI consistent without slowing anyone down. It feels like having a design ops teammate baked into the stack.",
  },
]

// TestimonialsSection renders the testimonials marketing section.
export default function TestimonialsSection() {
  return (
    <section id='reviews' className='bg-muted/50  border-foreground/10 relative border-b'>
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3'>
        <div className='border-x md:py-24 py-12'>
          <div className='mx-auto max-w-5xl px-6'>
            <div className='mx-auto max-w-2xl text-balance text-center'>
              <h2 className='text-foreground mb-4 text-3xl font-semibold tracking-tight md:text-4xl'>
                What our customers are saying about Auxx.Ai
              </h2>
              <p className='text-muted-foreground mb-6 md:mb-12 lg:mb-16'>
                Join the increasing number of customers and advocates who rely on Auxx.Ai for
                seamless and effective user analytics and experimentation.
              </p>
            </div>
            <div className='rounded-(--radius) border-border/50 relative lg:border'>
              <div className='lg:*:nth-4:rounded-r-none lg:*:nth-5:rounded-br-none lg:*:nth-6:rounded-b-none lg:*:nth-5:rounded-tl-none lg:*:nth-3:rounded-l-none lg:*:nth-2:rounded-tl-none lg:*:nth-2:rounded-br-none lg:*:nth-1:rounded-t-none grid gap-4 sm:grid-cols-2 sm:grid-rows-4 lg:grid-cols-3 lg:grid-rows-3 lg:gap-px'>
                {TESTIMONIALS.map((testimonial, index) => (
                  <TestimonialCard
                    key={index}
                    name={testimonial.name}
                    role={testimonial.role}
                    avatar={testimonial.avatar}
                    testimonial={testimonial.testimonial}
                  />
                ))}

                <div className='max-lg:rounded-(--radius) lg:rounded-tl-(--radius) lg:rounded-br-(--radius) relative overflow-hidden ring-foreground/5 row-start-1 flex flex-col justify-between gap-6 border border-transparent p-8 shadow-lg shadow-black/10 ring-1 lg:col-start-1'>
                  <RandomGradient
                    colors={[...GRADIENT_PALETTES.openai]}
                    mode='openai'
                    animated
                    driftAmplitude={30}
                  />
                  <div className='pointer-events-none absolute inset-0 bg-black/30' />
                  <div className='relative z-10 space-y-6'>
                    <Image
                      alt='Intercept Logo'
                      className='w-1/4'
                      src='/images/testimonials/intercept.jpg'
                      width={561}
                      height={201}
                    />

                    <p className='text-muted-foreground'>
                      "Auxx.Ai turned our design backlog into a single source of truth. Launching a
                      new flow now means reusing validated patterns instead of reinventing them."
                    </p>
                  </div>
                  <div className='relative z-10 flex items-center gap-3'>
                    <div className='ring-foreground/10 aspect-square size-9 overflow-hidden rounded-lg border border-transparent shadow-md shadow-black/15 ring-1'>
                      <img
                        src={avatars.calvin}
                        alt='Calvin Ochoa'
                        className='h-full w-full object-cover'
                        width={460}
                        height={460}
                        loading='lazy'
                      />
                    </div>
                    <div className='space-y-px'>
                      <p className='text-sm font-medium'>Calvin Ochoa</p>
                      <p className='text-muted-foreground text-xs'>
                        Director of Product Ops, Intercept
                      </p>
                    </div>
                  </div>
                </div>
                <div className='rounded-(--radius) relative overflow-hidden ring-foreground/5 row-start-3 flex flex-col justify-between gap-6 border border-transparent p-8 shadow-lg shadow-black/10 ring-1 sm:col-start-2 lg:row-start-2'>
                  <RandomGradient
                    colors={[...GRADIENT_PALETTES.openai]}
                    mode='openai'
                    animated
                    driftAmplitude={30}
                    seed={2}
                  />
                  <div className='pointer-events-none absolute inset-0 bg-black/30' />
                  <div className='relative z-10 space-y-6'>
                    <div className='h-[20px]'></div>
                    <p className='text-muted-foreground'>
                      "Auxx.Ai reshaped how we pilot features. We can spin up multi-variant tests in
                      minutes and retire the losers automatically before customers notice."
                    </p>
                  </div>
                  <div className='relative z-10 flex items-center gap-3'>
                    <div className='ring-foreground/10 aspect-square size-9 overflow-hidden rounded-lg border border-transparent shadow-md shadow-black/15 ring-1'>
                      <img
                        src={avatars.carolin}
                        alt='Carolin K.'
                        className='h-full w-full object-cover'
                        width={460}
                        height={460}
                        loading='lazy'
                      />
                    </div>
                    <div className='space-y-px'>
                      <p className='text-sm font-medium'>Carolin K.</p>
                      <p className='text-muted-foreground text-xs'>Director of Operation</p>
                    </div>
                  </div>
                </div>
                <div className='rounded-(--radius) relative overflow-hidden ring-foreground/5 flex flex-col justify-between gap-6 border border-transparent p-8 shadow-lg shadow-black/10 ring-1 sm:row-start-2 lg:col-start-3 lg:row-start-3 lg:rounded-bl-none lg:rounded-tr-none'>
                  <RandomGradient
                    colors={[...GRADIENT_PALETTES.openai]}
                    mode='openai'
                    animated
                    seed={3}
                    driftAmplitude={30}
                  />
                  <div className='pointer-events-none absolute inset-0 bg-black/30' />
                  <div className='relative z-10 space-y-6'>
                    <div className='h-[24px]'></div>

                    <p className='text-muted-foreground'>
                      "Auxx.Ai's analytics finally closed the loop between experiments and revenue.
                      The notifications alone have paid for the rollout with faster responses to
                      anomalies."
                    </p>
                  </div>
                  <div className='relative z-10 flex items-center gap-3'>
                    <div className='ring-foreground/10 aspect-square size-9 overflow-hidden rounded-lg border border-transparent shadow-md shadow-black/15 ring-1'>
                      <img
                        src={avatars.jack}
                        alt='Jack Harrington'
                        className='h-full w-full object-cover'
                        width={460}
                        height={460}
                        loading='lazy'
                      />
                    </div>
                    <div className='space-y-px'>
                      <p className='text-sm font-medium'>Jack Harrington</p>
                      <p className='text-muted-foreground text-xs'>
                        Founder, Harrington Consultant
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// TestimonialCardProps models the props passed to TestimonialCard.
type TestimonialCardProps = {
  name: string
  role: string
  avatar: string
  testimonial: string
}

// TestimonialCard outputs a single testimonial in the grid layout.
const TestimonialCard = ({ name, role, avatar, testimonial }: TestimonialCardProps) => {
  return (
    <div className='bg-card/25 rounded-(--radius) ring-foreground/[0.07] flex flex-col justify-end gap-6 border border-transparent p-8 ring-1'>
      <p className='text-foreground self-end text-balance before:mr-1 before:content-["\201C"] after:ml-1 after:content-["\201D"]'>
        {testimonial}
      </p>
      <div className='flex items-center gap-3'>
        <div className='ring-foreground/10 aspect-square size-9 overflow-hidden rounded-lg border border-transparent shadow-md shadow-black/15 ring-1'>
          <img
            src={avatar}
            alt={name}
            className='h-full w-full object-cover'
            width={460}
            height={460}
            loading='lazy'
          />
        </div>
        <div className='space-y-px'>
          <p className='text-sm font-medium'>{name}</p>
          <p className='text-muted-foreground text-xs'>{role}</p>
        </div>
      </div>
    </div>
  )
}
