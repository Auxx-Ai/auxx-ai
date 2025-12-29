// apps/web/src/app/(website)/platform/messaging/_components/messaging-hero.tsx
'use client'
import { motion } from 'motion/react'
import { MessagesSquare } from 'lucide-react'
import { ImageIllustration } from './image-illustration'

const AnimatedGroup = ({ children, variants }: { children: React.ReactNode; variants: any }) => {
  return (
    <motion.div initial="hidden" animate="visible" variants={variants}>
      {children}
    </motion.div>
  )
}

export default function MessagingHero() {
  return (
    <main role="main" className="overflow-hidden border-b">
      <section className="bg-muted relative">
        <motion.div
          initial={{ opacity: 0, y: -72, filter: 'blur(12px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 2, ease: 'easeInOut' }}
          className="mask-radial-from-80% mask-radial-at-top-right mask-radial-[100%_85%] absolute inset-0 opacity-75">
          <img
            src="https://images.unsplash.com/photo-1588345921523-c2dcdb7f1dcd?q=80&w=2070&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D"
            alt=""
            className="size-full -scale-y-100 object-cover"
          />
        </motion.div>

        <div className="perspective-dramatic pb-20 pt-24 md:pt-32 lg:py-44">
          <div className="relative z-10 mx-auto max-w-5xl px-6 text-center">
            <AnimatedGroup
              variants={{
                container: {
                  visible: {
                    transition: {
                      staggerChildren: 0.05,
                      delayChildren: 0.1,
                    },
                  },
                },
                item: {
                  hidden: {
                    opacity: 0,
                    filter: 'blur(12px)',
                    y: -16,
                  },
                  visible: {
                    opacity: 1,
                    filter: 'blur(0px)',
                    y: 0,
                    rotateX: 0,
                    transition: {
                      type: 'spring',
                      bounce: 0.3,
                      duration: 1,
                    },
                  },
                },
              }}>
              <h1
                key={1}
                className="mx-auto mt-8 inline-flex max-w-xl flex-wrap items-center justify-center gap-x-2 text-balance text-3xl font-semibold sm:text-4xl lg:text-5xl">
                Unified <span className="text-muted-foreground">Customer </span>
                <MessagesSquare /> <span className="text-muted-foreground">Communication</span> Hub
              </h1>

              <div key={2} className="mx-auto mt-4 max-w-md">
                <p className="text-muted-foreground mb-5 text-balance text-lg">
                  Manage all customer conversations from a single, intelligent platform. Set up in
                  minutes.
                </p>
              </div>
            </AnimatedGroup>

            <AnimatedGroup
              variants={{
                container: {
                  visible: {
                    transition: {
                      staggerChildren: 1,
                      delayChildren: 0.4,
                    },
                  },
                },
                item: {
                  hidden: {
                    opacity: 0,
                    filter: 'blur(12px)',
                    y: -120,
                    rotateX: 56,
                    scale: 2,
                  },
                  visible: {
                    opacity: 1,
                    filter: 'blur(0px)',
                    y: 0,
                    scale: 1,
                    rotateX: 0,
                    transition: {
                      type: 'spring',
                      bounce: 0.2,
                      duration: 2,
                    },
                  },
                },
              }}>
              <ImageIllustration />
            </AnimatedGroup>
          </div>
        </div>
      </section>
    </main>
  )
}
