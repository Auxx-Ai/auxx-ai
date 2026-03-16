// apps/web/src/app/(website)/_components/bento/index.tsx
import { Card } from '~/components/ui/card'
import { CurrencyIllustration } from './currency-illustration'
import { NotificationIllustration } from './notification-illustration'
import { PollIllustration } from './poll-illustration'
import { ReplyIllustration } from './reply-illustration'
import { VisualizationIllustration } from './visualization-illustration'

// BentoOne renders the feature bento grid with supporting illustrations.
export default function BentoOne() {
  return (
    <section className='relative border-foreground/10 border-y'>
      <div className='relative z-10 mx-auto max-w-6xl border-foreground/10 border-x px-3'>
        <div className='border-foreground/10 border-x'>
          <div className='bg-muted/50 @container py-24 [--color-primary:var(--color-sky-600)]'>
            <h2 className='sr-only'>Features</h2>
            <div className='mx-auto w-full max-w-5xl px-6'>
              <div className='@xl:grid-cols-2 @3xl:grid-cols-6 grid gap-4 [--color-border:color-mix(in_oklab,var(--color-foreground)10%,transparent)]'>
                <Card className='@3xl:col-span-2 grid grid-rows-[auto_1fr] space-y-8 overflow-hidden rounded-2xl p-8'>
                  <div>
                    <h3 className='text-foreground font-semibold'>Scheduled Reports</h3>
                    <p className='text-muted-foreground mt-3'>
                      Automate report delivery to stakeholders with customizable scheduling options.
                    </p>
                  </div>
                  <div className='bg-linear-to-b relative -m-8 flex items-end from-transparent via-rose-50 to-amber-50 dark:via-rose-500/10 dark:to-amber-500/10 p-8'>
                    <Stripes />
                    <NotificationIllustration variant='mixed' />
                  </div>
                </Card>
                <Card className='@3xl:col-span-2 grid grid-rows-[auto_1fr] space-y-8 overflow-hidden rounded-2xl p-8'>
                  <div>
                    <h3 className='text-foreground font-semibold'>Collaborative Analysis</h3>
                    <p className='text-muted-foreground mt-3'>
                      Add comments, share insights, and work together with your team to extract
                      maximum.
                    </p>
                  </div>
                  <div className='bg-linear-to-b relative -m-8 flex items-end from-transparent via-rose-50 to-amber-50 dark:via-rose-500/10 dark:to-amber-500/10 p-8'>
                    <Stripes />
                    <CurrencyIllustration />
                  </div>
                </Card>
                <Card className='@3xl:col-span-2 grid grid-rows-[auto_1fr] gap-8 overflow-hidden rounded-2xl p-8'>
                  <div>
                    <h3 className='text-foreground font-semibold'>Collaborative Analysis</h3>
                    <p className='text-muted-foreground mt-3'>
                      Add comments, share insights, and work together with your team to extract
                      maximum.
                    </p>
                  </div>
                  <div className='bg-linear-to-b relative -m-8 flex items-end from-transparent via-rose-50 to-amber-50 dark:via-rose-500/10 dark:to-amber-500/10 p-8'>
                    <Stripes />
                    <ReplyIllustration className='relative mt-0 w-full' />
                  </div>
                </Card>
                <Card className='@3xl:col-span-2 group grid grid-rows-[auto_1fr] gap-8 overflow-hidden rounded-2xl p-8'>
                  <div>
                    <h3 className='text-foreground font-semibold'>Collaborative Analysis</h3>
                    <p className='text-muted-foreground mt-3'>
                      Add comments, share insights, and work together with your team to extract
                      maximum.
                    </p>
                  </div>

                  <div className='bg-linear-to-b relative -m-8 flex items-end from-transparent via-rose-50 to-amber-50 dark:via-rose-500/10 dark:to-amber-500/10 p-8'>
                    <Stripes />
                    <PollIllustration />
                  </div>
                </Card>
                <Card className='@xl:col-span-2 @3xl:col-span-4 grid grid-rows-[auto_1fr] gap-8 overflow-hidden rounded-2xl p-8'>
                  <div>
                    <h3 className='text-foreground font-semibold'>Collaborative Analysis</h3>
                    <p className='text-muted-foreground mt-3'>
                      Add comments, share insights, and work together with your team to extract
                      maximum.
                    </p>
                  </div>
                  <VisualizationIllustration />
                </Card>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// Stripes renders the striped overlay pattern for illustration cards.
const Stripes = () => (
  <div
    aria-hidden
    className='absolute -inset-x-6 inset-y-0 bg-[repeating-linear-gradient(-45deg,black,black_1px,transparent_1px,transparent_6px)] mix-blend-overlay [mask-image:radial-gradient(ellipse_50%_50%_at_50%_50%,#000_70%,transparent_100%)]'
  />
)
