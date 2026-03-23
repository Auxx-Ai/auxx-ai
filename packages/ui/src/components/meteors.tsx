'use client'

import { cn } from '@auxx/ui/lib/utils'
import { useEffect, useState } from 'react'

export interface MeteorsProps {
  className?: string
  children?: React.ReactNode
  /** Number of meteors */
  count?: number
  /** Meteor angle in degrees (215 = diagonal down-left) */
  angle?: number
  /** Meteor color */
  color?: string
  /** Tail gradient color */
  tailColor?: string
}

interface MeteorData {
  id: number
  left: number
  delay: number
  duration: number
}

export function Meteors({
  className,
  children,
  count = 20,
  angle = 215,
  color = '#64748b',
  tailColor = '#64748b',
}: MeteorsProps) {
  const [meteors, setMeteors] = useState<MeteorData[]>([])

  // Generate meteor data on client only to avoid hydration mismatch
  useEffect(() => {
    setMeteors(
      Array.from({ length: count }, (_, i) => ({
        id: i,
        left: i * (200 / count), // Distribute across and beyond viewport width
        delay: Math.random() * 5,
        duration: 3 + Math.random() * 7,
      }))
    )
  }, [count])

  return (
    <div className={cn('fixed inset-0 overflow-hidden', className)}>
      {/* Keyframe animation - uses vmax for viewport scaling */}
      <style>{`
        @keyframes meteor-fall {
          0% {
            transform: rotate(${angle}deg) translateX(0);
            opacity: 1;
          }
          70% {
            opacity: 1;
          }
          100% {
            transform: rotate(${angle}deg) translateX(-100vmax);
            opacity: 0;
          }
        }
      `}</style>

      {/* Subtle gradient overlay */}
      <div
        className='pointer-events-none absolute inset-0'
        style={{
          background: `
            radial-gradient(ellipse at 50% 0%, rgba(30, 40, 60, 0.3) 0%, transparent 50%),
            radial-gradient(ellipse at 100% 100%, rgba(20, 20, 40, 0.2) 0%, transparent 50%)
          `,
        }}
      />

      {/* Meteors */}
      {meteors.map((meteor) => (
        <span
          key={meteor.id}
          className='absolute h-0.5 w-0.5 rounded-full'
          style={{
            top: '-40px',
            left: `${meteor.left}%`,
            backgroundColor: color,
            boxShadow: '0 0 0 1px rgba(255,255,255,0.1)',
            animation: `meteor-fall ${meteor.duration}s linear infinite`,
            animationDelay: `${meteor.delay}s`,
          }}>
          {/* Tail */}
          <span
            className='absolute top-1/2 -translate-y-1/2'
            style={{
              left: '100%',
              width: '50px',
              height: '1px',
              background: `linear-gradient(to right, ${tailColor}, transparent)`,
            }}
          />
        </span>
      ))}

      {/* Vignette */}
      <div
        className='pointer-events-none absolute inset-0'
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 0%, transparent 50%, rgba(10,10,15,0.8) 100%)',
        }}
      />

      {/* Content layer */}
      {children && <div className='relative z-10 h-full w-full'>{children}</div>}
    </div>
  )
}
