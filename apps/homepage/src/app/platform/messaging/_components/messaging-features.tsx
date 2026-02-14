'use client'
import { Share2, Smile, Sparkles, SquaresUnite } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import Image from 'next/image'
import { useState } from 'react'
import { cn } from '~/lib/utils'

type Preview = 'intuitive' | 'unified' | 'sharing' | 'ai-copilot'

type PreviewItem = {
  name: Preview
  label: string
  image: string
  icon: React.ReactNode
}

const previews: PreviewItem[] = [
  {
    name: 'intuitive',
    label: 'Intuitive',
    image: '/images/platform/messaging/intuitive.png',
    icon: <Smile />,
  },
  {
    name: 'unified',
    label: 'Unified',
    image: '/images/platform/messaging/unified.png',
    icon: <SquaresUnite />,
  },
  {
    name: 'sharing',
    label: 'Sharing',
    image: '/images/platform/messaging/sharing.png',
    icon: <Share2 />,
  },
  {
    name: 'ai-copilot',
    label: 'AI Copilot',
    image: '/images/platform/messaging/ai-copilot.png',
    icon: <Sparkles />,
  },
]

const MessagingFeatures = () => {
  const [active, setActive] = useState<Preview>('intuitive')
  const currentPreview = previews.find((p) => p.name === active)!
  return (
    <section className='relative border-foreground/10 border-b'>
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3'>
        <div className='border-x'>
          <div className='relative z-10 lg:pt-30 pt-12 mx-auto grid max-w-5xl items-end gap-4 px-6 md:grid-cols-2'>
            <div>
              <h1 className='text-balance text-5xl font-semibold'>
                Deliver top-tier support across all your channels
              </h1>
            </div>
            <div className='max-w-sm'>
              <p className='text-muted-foreground mb-6 text-balance text-lg lg:text-xl'>
                Transform customer support with instant AI-powered responses across email, chat,
                voice, and social media.
              </p>
            </div>
          </div>

          <div className='@container  relative z-10 border-b pt-12 [mask-image:radial-gradient(ellipse_80%_95%_at_50%_0%,#000_80%,transparent_100%)]'>
            <div className='mx-auto max-w-6xl'>
              <div className='border-border-illustration grid grid-cols-[1fr_auto_1fr] border-y pb-2'>
                <div className='h-[calc(100%+0.5rem)] bg-[repeating-linear-gradient(45deg,var(--color-border-illustration),var(--color-border-illustration)_1px,transparent_1px,transparent_6px)]' />
                <div className='bg-muted/50 max-w-3xl lg:min-w-[42.5rem]'>
                  <div className='divide-border-illustration border-border-illustration relative z-20 grid grid-cols-4 items-center justify-center gap-px divide-x border-x *:h-16'>
                    {previews.map((preview) => (
                      <button
                        key={preview.name}
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
              <div className='bg-background/60 ring-foreground/10 sm:aspect-3/2 aspect-square rounded-2xl p-1 shadow-2xl shadow-black/25 ring-1'>
                <AnimatePresence mode='wait'>
                  <motion.div
                    key={active}
                    initial={{ opacity: 0, scale: 0.995 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.995 }}
                    transition={{ duration: 0.2 }}
                    className='bg-background ring-border-illustration sm:aspect-3/2 relative aspect-square origin-top overflow-hidden rounded-xl border-4 border-l-8 border-transparent shadow ring-1'>
                    <Image
                      className='object-top-left size-full object-cover'
                      src={currentPreview.image}
                      alt={currentPreview.name}
                      width={2880}
                      height={1920}
                      sizes='(max-width: 640px) 768px, (max-width: 768px) 1024px, (max-width: 1024px) 1280px, 1280px'
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
