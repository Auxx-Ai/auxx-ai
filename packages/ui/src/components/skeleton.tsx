import { cn } from '@auxx/ui/lib/utils'

const Skeleton: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => {
  return <div className={cn('animate-pulse rounded-md bg-foreground/10', className)} {...props} />
}

export { Skeleton }
