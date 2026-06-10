// apps/web/src/components/evals/ui/messages/eval-customer-message.tsx

'use client'

/**
 * The customer's turn in an agent-simulation trace — the "user" side of the
 * conversation. Right-aligned bubble mirroring kopilot's `UserMessage`
 * (`user-message.tsx`), but the persona text is plain (no HTML / `@[reference]`
 * parsing, no edit/retry actions — a replayed run has nothing to edit).
 */
export function EvalCustomerMessage({ text }: { text: string }) {
  return (
    <div className='flex flex-col items-end gap-1'>
      <div className='bg-illustration text-muted-foreground max-w-4/5 ring-border-illustration shadow-black/6.5 ml-auto w-fit whitespace-pre-wrap rounded-l-xl rounded-br rounded-tr-xl px-3 py-2 text-sm/5 shadow ring-1'>
        {text}
      </div>
    </div>
  )
}
