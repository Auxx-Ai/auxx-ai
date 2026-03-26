'use client'
import { Database, Smile, Sparkles, SquaresUnite } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { AutoplayVideo } from '~/components/autoplay-video'
import { cn } from '~/lib/utils'

type Preview = 'intuitive' | 'unified' | 'sharing' | 'ai-copilot'

type PreviewItem = {
  name: Preview
  label: string
  video: string
  icon: React.ReactNode
}

const previews: PreviewItem[] = [
  {
    name: 'intuitive',
    label: 'Intuitive',
    video: '/videos/mail-flow.mp4',
    icon: <Smile />,
  },
  {
    name: 'unified',
    label: 'Unified',
    video: '/videos/app-install.mp4',
    icon: <SquaresUnite />,
  },
  {
    name: 'sharing',
    label: 'Data Model',
    video: '/videos/entity-template.mp4',
    icon: <Database />,
  },
  {
    name: 'ai-copilot',
    label: 'AI Copilot',
    video: '/videos/ai-model-choose.mp4',
    icon: <Sparkles />,
  },
]

const MessagingFeatures = () => {
  const [active, setActive] = useState<Preview>('intuitive')
  const currentPreview = previews.find((p) => p.name === active)!
  return (
    <section className='relative border-foreground/10 border-b border-t'>
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3'>
        <div className='border-x'>
          <div className='@container  relative z-10 border-b  [mask-image:radial-gradient(ellipse_80%_115%_at_50%_0%,#000_85%,transparent_100%)] dark:mask-b-from-85% dark:mask-b-to-100% dark:mask-radial-from-65% dark:mask-radial-at-top dark:mask-radial-[125%_100%]'>
            <div className='mx-auto max-w-6xl'>
              <div className='border-border-illustration grid grid-cols-[1fr_auto_1fr] border-y pb-2'>
                <div className='h-[calc(100%+0.5rem)] bg-[repeating-linear-gradient(45deg,var(--color-border-illustration),var(--color-border-illustration)_1px,transparent_1px,transparent_6px)]' />
                <div className='bg-muted/50 max-w-3xl lg:min-w-[42.5rem]'>
                  <div className='divide-border-illustration border-border-illustration relative z-20 grid grid-cols-4 items-center justify-center gap-px divide-x border-x *:h-16'>
                    {previews.map((preview) => (
                      <button
                        key={preview.name}
                        aria-label={preview.label}
                        onClick={() => setActive(preview.name)}
                        className='group flex cursor-pointer items-center justify-center px-2'>
                        <div
                          className={cn(
                            'ring-border-illustration group-active:scale-99 flex h-10 items-center gap-2 rounded-full px-4 ring-1 transition-all duration-150 [&>svg]:size-4',
                            active === preview.name
                              ? 'bg-background shadow shadow-black/10'
                              : 'group-hover:bg-background/50'
                          )}>
                          {preview.icon}
                          <span className='@max-md:hidden'>{preview.label}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                <div className='h-[calc(100%+0.5rem)] bg-[repeating-linear-gradient(45deg,var(--color-border-illustration),var(--color-border-illustration)_1px,transparent_1px,transparent_6px)]' />
              </div>
            </div>
            <div className='relative mx-auto -mt-2 max-w-6xl max-md:mx-1 lg:px-10'>
              <div className='bg-background/60 dark:bg-white/10 ring-foreground/10 sm:aspect-3/2 aspect-square rounded-2xl p-1 shadow-2xl shadow-black/25 dark:shadow-black/50 ring-1'>
                <AnimatePresence mode='wait'>
                  <motion.div
                    key={active}
                    initial={{ opacity: 0, scale: 0.995 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.995 }}
                    transition={{ duration: 0.2 }}
                    className='bg-background ring-border-illustration sm:aspect-3/2 relative aspect-square origin-top overflow-hidden rounded-xl border-4 border-l-8 border-transparent dark:border-zinc-900 shadow ring-1'>
                    <AutoplayVideo
                      autoPlay
                      loop
                      muted
                      className='size-full object-cover object-top-left'
                      src={currentPreview.video}
                    />
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export default MessagingFeatures
