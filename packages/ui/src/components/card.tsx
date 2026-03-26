import { cn } from '@auxx/ui/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'

const cardVariants = cva('rounded-xl border text-card-foreground shadow-xs', {
  variants: {
    variant: {
      default: 'bg-card [&_[data-slot=card-description]]:text-muted-foreground',
      translucent:
        'bg-translucent text-white/90 border-transparent [&_[data-slot=card-title]]:text-white/80 [&_[data-slot=card-description]]:text-white/50',
    },
  },
  defaultVariants: { variant: 'default' },
})

interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

function Card({ className, variant, children, ...props }: CardProps) {
  return (
    <div className={cn(cardVariants({ variant, className }), 'relative')} {...props}>
      {variant === 'translucent' && (
        <div
          aria-hidden='true'
          className='absolute inset-1 overflow-hidden rounded-[8px] border border-white/10 bg-white/5 pointer-events-none'
        />
      )}
      {children}
    </div>
  )
}

function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot='card-header'
      className={cn('flex flex-col space-y-1.5 p-3', className)}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot='card-title'
      className={cn('font-semibold leading-none tracking-tight', className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot='card-description' className={cn('text-sm', className)} {...props} />
}

function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-3 pt-0', className)} {...props} />
}

function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center p-3 pt-0', className)} {...props} />
}

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }
