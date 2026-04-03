// apps/web/src/components/kopilot/ui/blocks/fallback-block.tsx

export function FallbackBlock({ type, data }: { type: string; data: unknown }) {
  return (
    <div className='rounded-md border bg-muted/50 px-3 py-2 text-xs text-muted-foreground'>
      <span className='font-mono'>{type}</span>
    </div>
  )
}
