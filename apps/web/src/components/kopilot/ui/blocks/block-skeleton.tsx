// apps/web/src/components/kopilot/ui/blocks/block-skeleton.tsx

export function BlockSkeleton({ type }: { type: string }) {
  return (
    <div className='animate-pulse rounded-lg border bg-muted/30 p-3'>
      <div className='mb-2 h-3 w-24 rounded bg-muted/50' />
      <div className='h-3 w-full rounded bg-muted/50' />
    </div>
  )
}
