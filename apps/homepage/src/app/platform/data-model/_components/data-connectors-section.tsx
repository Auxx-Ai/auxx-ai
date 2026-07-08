// apps/homepage/src/app/platform/data-model/_components/data-connectors-section.tsx
import { Plug, Webhook } from 'lucide-react'
import Image from 'next/image'

const CARD =
  'ring-border bg-card text-card-foreground shadow-black/6.5 shadow ring-1 grid gap-8 rounded-2xl p-8'

const WEBHOOK_TOPICS = ['orders/create', 'orders/paid', 'customers/update', 'refunds/create']

/**
 * Data Connectors marketing section (Tailark quartz bento-5 style): intro +
 * five bento cards with real product screenshots. Shared by
 * /platform/data-model, /platform/crm, and the root homepage.
 */
export default function DataConnectorsSection() {
  return (
    <section className='@container overflow-hidden border-b'>
      <div className='mx-auto w-full max-w-5xl px-6 py-16 md:py-24'>
        {/* Intro */}
        <div className='mx-auto mb-12 max-w-3xl text-center md:mb-16'>
          <div className='mx-auto inline-flex items-center gap-2 rounded-full border border-foreground/10 bg-muted/40 px-3 py-1 text-xs'>
            <Plug className='size-3.5 text-emerald-500' />
            <span className='text-muted-foreground'>Data Connectors</span>
          </div>
          <h2 className='mt-6 text-balance text-4xl font-semibold md:text-5xl'>
            A CRM that fills itself.
          </h2>
          <p className='text-muted-foreground mx-auto mt-4 max-w-2xl text-balance text-lg'>
            Connect your store, billing, and tools. Records sync in as real CRM records — ready to
            filter, segment, report on, and hand to your AI agents.
          </p>
        </div>

        <div className='grid grid-cols-1 gap-3 @xl:grid-cols-2 @4xl:grid-cols-10'>
          {/* Card 1 — Connect any source (text top, visual below) */}
          <div className={`${CARD} grid-rows-[auto_1fr] @4xl:col-span-4`}>
            <div>
              <h3 className='text-foreground font-semibold'>Connect any source.</h3>
              <p className='text-muted-foreground mt-3'>
                Start from a template — Shopify, Stripe, GitHub — or point at any REST API and
                define the endpoint yourself.
              </p>
            </div>
            <div aria-hidden='true' className='flex items-center'>
              <div className='ring-border-illustration relative z-10 w-full max-w-none overflow-hidden rounded-xl bg-white shadow-xl ring-1 @xl:-ml-24 @xl:w-[150%]'>
                <Image
                  src='/images/platform/data-connectors/connect-sources-list.png'
                  width={1285}
                  height={605}
                  alt='Source templates: Custom REST API, Stripe, GitHub, and Shopify'
                  className='h-full w-full'
                />
              </div>
            </div>
          </div>

          {/* Card 2 — Always in sync (text top, wide visual below) */}
          <div className={`${CARD} grid-rows-[auto_1fr] @xl:col-span-2 @4xl:col-span-6`}>
            <div>
              <h3 className='text-foreground font-semibold'>Always in sync.</h3>
              <p className='text-muted-foreground mt-3'>
                Syncs run as often as every 15 minutes and leave receipts — live per-stream
                progress, counts for every run, and a full history.
              </p>
            </div>
            <div aria-hidden='true' className='relative'>
              <div className='ring-border-illustration mask-b-from-65% relative z-10 h-64 w-full overflow-hidden rounded-t-xl bg-white shadow-xl ring-1 @xl:-mr-20 @xl:w-[calc(100%+5rem)]'>
                <Image
                  src='/images/platform/data-connectors/sync-runs.png'
                  width={1526}
                  height={1180}
                  alt='Sync runs panel with live per-stream progress and run history'
                  className='h-full w-full object-cover object-left-top'
                />
              </div>
            </div>
          </div>

          {/* Card 3 — Real-time webhooks (dark, visual top) */}
          <div className={`${CARD} grid-rows-[1fr_auto] @4xl:col-span-3`} data-theme='dark'>
            <div aria-hidden='true' className='flex items-center justify-center'>
              <div className='relative flex w-fit flex-col items-center gap-4'>
                <div className='border-border-illustration absolute -inset-x-6 inset-y-0 border-y border-dashed' />
                <div className='border-border-illustration absolute -inset-y-6 inset-x-0 border-x border-dashed' />
                <div className='border-border-illustration bg-illustration relative flex aspect-square size-16 items-center justify-center rounded-[7px] border shadow-lg shadow-black/35'>
                  <Webhook className='size-6' />
                </div>
                <div className='relative flex flex-wrap justify-center gap-1.5'>
                  {WEBHOOK_TOPICS.map((topic) => (
                    <div
                      key={topic}
                      className='border-border-illustration bg-illustration flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 shadow-lg shadow-black/35'>
                      <span className='relative flex size-1.5'>
                        <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75' />
                        <span className='relative inline-flex size-1.5 rounded-full bg-emerald-500' />
                      </span>
                      <span className='font-mono text-xs'>{topic}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div>
              <h3 className='text-foreground font-semibold'>Real-time webhooks.</h3>
              <p className='text-muted-foreground mt-3'>
                Provider events update records the moment they happen — a nightly check backstops
                anything missed.
              </p>
            </div>
          </div>

          {/* Card 4 — Field mapping (stacked-deck visual top) */}
          <div className={`${CARD} grid-rows-[1fr_auto] @4xl:col-span-4`}>
            <div
              aria-hidden='true'
              className='before:z-1 mask-b-from-65% before:bg-card after:bg-card before:border-foreground/10 after:border-foreground/5 relative -mx-4 px-4 pt-6 before:absolute before:inset-x-6 before:bottom-0 before:top-4 before:rounded-2xl before:border after:absolute after:inset-x-8 after:bottom-0 after:top-2 after:rounded-2xl after:border'>
              <div className='border-border-illustration relative z-10 overflow-hidden rounded-t-2xl border bg-white shadow-lg'>
                <Image
                  src='/images/platform/data-connectors/field-mapping.png'
                  width={1270}
                  height={1268}
                  alt='Field mappings pointing a source payload tree at Contact fields'
                  className='h-full w-full'
                />
              </div>
            </div>
            <div>
              <h3 className='text-foreground font-semibold'>Map fields visually.</h3>
              <p className='text-muted-foreground mt-3'>
                Point source fields at CRM fields — contribute into contacts and tickets or create
                new record types, with per-field update rules.
              </p>
            </div>
          </div>

          {/* Card 5 — Formulas (visual top) */}
          <div
            className={`${CARD} grid-rows-[1fr_auto] @xl:row-start-1 @4xl:col-span-3 @4xl:row-start-auto`}>
            <div aria-hidden='true' className='flex items-center'>
              <div className='ring-border-illustration mask-b-from-75% relative z-10 w-full max-w-none overflow-hidden rounded-xl bg-white shadow-xl ring-1 @xl:-mr-[50%] @xl:w-[150%]'>
                <Image
                  src='/images/platform/data-connectors/formula-dialog.png'
                  width={1140}
                  height={960}
                  alt='Formula editor computing a field with autocomplete for source fields and functions'
                  className='h-full w-full'
                />
              </div>
            </div>
            <div>
              <h3 className='text-foreground font-semibold'>Transform on the way in.</h3>
              <p className='text-muted-foreground mt-3'>
                Formulas compute fields from source values — combine, clean up, branch on
                conditions. No ETL, no scripts.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
