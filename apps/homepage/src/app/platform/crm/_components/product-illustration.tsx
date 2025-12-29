// apps/web/src/app/(website)/platform/crm/_components/product-illustration.tsx
'use client'
import Image from 'next/image'
import { useState, useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'

const screenshots = [
  '/images/platform/crm/crm-table.png',
  '/images/platform/crm/crm-fields.png',
  '/images/platform/crm/crm-options.png',
]

export const ProductIllustration = () => {
  const [active, setActive] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setActive((prev) => (prev + 1) % screenshots.length)
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={active}
        initial={{ opacity: 0, scale: 0.9, y: 32 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 1.1, y: -32 }}
        transition={{ duration: 1.2, type: 'spring', bounce: 0.2, ease: 'easeInOut' }}
        className="origin-bottom">
        <div className="bg-background/60 ring-foreground/10 rounded-2xl p-1 shadow-xl shadow-black/10 ring-1">
          <div className="bg-background ring-border-illustration relative aspect-auto origin-top overflow-hidden rounded-xl border-4 border-l-8 border-transparent shadow ring-1">
            <Image
              className="object-top-left min-w-xl size-full object-cover"
              src={screenshots[active]}
              alt="app screenshot"
              width={2880}
              height={1920}
              sizes="(max-width: 640px) 768px, (max-width: 768px) 1024px, (max-width: 1024px) 1280px, 1280px"
            />
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
