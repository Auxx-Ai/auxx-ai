// apps/homepage/src/app/_components/sections/hero-v2/kopilot-mock.tsx
'use client'

import { Sparkles } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import {
  MockAppSidebar,
  MockBrowserChrome,
  MockKopilotWindow,
  MockMainPage,
} from '~/app/platform/ai/_mocks'
import { KOPILOT_HERO_SCRIPT } from '~/app/platform/ai/kopilot/_components/kopilot-hero-script'
import { AgentLog } from './agent-log'

export function KopilotMock() {
  const reduce = useReducedMotion()

  const float = (delay: number) =>
    reduce
      ? {}
      : {
          animate: { y: [0, -6, 0] },
          transition: { duration: 7, repeat: Infinity, ease: 'easeInOut', delay },
        }

  return (
    <div className='pointer-events-none relative h-full min-h-[80vh] w-full select-none transform-3d'>
      {/* Crosshatch mesh background — fades radially */}
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0 mask-radial-from-55% mask-radial-to-75% opacity-60'
        style={{
          backgroundImage: `
            repeating-linear-gradient(22.5deg, transparent, transparent 1px, rgba(120, 120, 140, 0.06) 1px, rgba(120, 120, 140, 0.06) 2px, transparent 2px, transparent 4px),
            repeating-linear-gradient(67.5deg, transparent, transparent 1px, rgba(120, 120, 140, 0.05) 1px, rgba(120, 120, 140, 0.05) 2px, transparent 2px, transparent 4px),
            repeating-linear-gradient(112.5deg, transparent, transparent 1px, rgba(120, 120, 140, 0.04) 1px, rgba(120, 120, 140, 0.04) 2px, transparent 2px, transparent 4px),
            repeating-linear-gradient(157.5deg, transparent, transparent 1px, rgba(120, 120, 140, 0.03) 1px, rgba(120, 120, 140, 0.03) 2px, transparent 2px, transparent 4px)
          `,
        }}
      />

      {/* Back layer — chrome and the inner content (sidebar / main+kopilot) are SIBLINGS
          under one relative wrapper. Each layer's Z is a direct world coordinate (no parent
          transform compounding). Single float on the outer wrapper keeps the whole composition
          moving as a unit. Entrance is Z-only: each layer starts ~40px closer to the viewer
          than its resting Z, then settles back into its resting depth. */}
      <motion.div
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className='absolute right-[-22vw] bottom-[-6vh] z-0 transform-3d'>
        <div className='relative rotate-x-[30deg] rotate-y-[24deg] rotate-[344deg] mask-radial-from-65% mask-radial-at-top-right mask-radial-[200%_100%] perspective-[4000px] transform-3d'>
          <motion.div {...float(0)} className='relative w-[1100px] max-w-none transform-3d'>
            {/* Layer 1 — chrome frame (world z:-160). Static; outer wrapper handles fade. */}
            <div className='transform-3d' style={{ transform: 'translateZ(-160px)' }}>
              <MockBrowserChrome allowOverflow variant='regular' className='transform-3d'>
                <div className='h-[620px]' />
              </MockBrowserChrome>
            </div>

            {/* Content layers — absolutely positioned over chrome's content area.
                Top offset (50px) matches chrome's outer p-2 + header height (~9 + 41). */}
            <div
              className='pointer-events-none absolute flex transform-3d'
              style={{ top: '50px', left: '10px', right: '10px', height: '620px' }}>
              {/* Layer 2 — sidebar (world z:-40). Static. */}
              <div
                className='hidden flex-shrink-0 shadow-2xl shadow-black/50 transform-3d md:flex'
                style={{ transform: 'translateZ(-40px)' }}>
                <MockAppSidebar activeKey='kopilot' />
              </div>

              {/* Layer 3 — main page (world z:80), kopilot window nested at relative z:140 (world 220). Static. */}
              <div
                className='flex flex-1 shadow-2xl shadow-black/60 transform-3d'
                style={{ transform: 'translateZ(80px)' }}>
                <MockMainPage allowOverflow>
                  <div
                    className='flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-[calc(var(--radius-2xl)-4px)] transform-3d'
                    style={{ transform: 'translateZ(140px)' }}>
                    <MockKopilotWindow
                      breadcrumb={{
                        trail: ['Chats'],
                        title: 'Open Support Tickets Summary',
                        titleMobile: 'Tickets',
                      }}
                      script={KOPILOT_HERO_SCRIPT}
                      composerPlaceholder='Ask Kopilot...'
                      modelLabel='GPT-5.4 Nano'
                    />
                  </div>
                </MockMainPage>
              </div>
            </div>
          </motion.div>
        </div>
      </motion.div>

      {/* Mid layer — agent log. translateZ:340 keeps it above the back-layer Kopilot world z (220). */}
      <motion.div
        initial={reduce ? false : { opacity: 0, z: 340 }}
        animate={{ opacity: 1, z: 340 }}
        transition={{ duration: 0.5, ease: 'easeOut', delay: 0.15 }}
        className='absolute right-[18%] top-[38%] z-10 perspective-[4000px] transform-3d'>
        <motion.div {...float(1.2)} className='transform-3d'>
          <div className='rotate-x-[30deg] rotate-y-[24deg] rotate-[344deg]'>
            <AgentLog />
          </div>
        </motion.div>
      </motion.div>

      {/* Front layer — Kopilot prompt bubble, highest at translateZ:440. */}
      <motion.div
        initial={reduce ? false : { opacity: 0, z: 440 }}
        animate={{ opacity: 1, z: 440 }}
        transition={{ duration: 0.5, ease: 'easeOut', delay: 0.25 }}
        className='absolute right-[10%] top-[18%] z-20 perspective-[4000px] transform-3d'>
        <motion.div {...float(2.4)}>
          <div className='rotate-x-[30deg] rotate-y-[24deg] rotate-[344deg]'>
            <div className='w-[360px] max-w-full rounded-xl border border-foreground/10 bg-background/95 p-3.5 shadow-2xl shadow-black/25 backdrop-blur-md'>
              <div className='mb-2 flex items-center gap-2'>
                <div className='flex size-5 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-500 text-white'>
                  <Sparkles className='size-2.5' />
                </div>
                <span className='text-xs font-medium text-foreground'>Kopilot</span>
              </div>
              <p className='text-sm leading-relaxed text-foreground'>
                Reply to the open VIP tickets and tag anything about shipping delays.
              </p>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </div>
  )
}
