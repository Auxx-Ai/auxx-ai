// apps/homepage/src/app/platform/sequences/_mocks/mock-step-editor.tsx

import { ChevronDown, Mail, Mails, Paperclip, PenLine, Plus } from 'lucide-react'
import { cn } from '~/lib/utils'

export type StepEditorVariant = 'placeholders' | 'snippets' | 'sender'

/** Placeholder span — mirrors the TipTap placeholder node's chip rendering. */
function Token({ label, fallback }: { label: string; fallback?: string }) {
  return (
    <span className='mx-0.5 inline-flex items-center gap-1 rounded bg-blue-500/12 px-1.5 py-0.5 align-baseline text-[11px] font-medium text-blue-600 dark:text-blue-300'>
      {label}
      {fallback ? (
        <span className='rounded bg-blue-500/15 px-1 text-[9px] font-normal opacity-80'>
          {fallback}
        </span>
      ) : null}
    </span>
  )
}

function EditorShell({ children }: { children: React.ReactNode }) {
  return (
    <div className='rounded-xl border border-border/60 bg-card p-3 shadow-sm ring-1 ring-foreground/5'>
      {children}
    </div>
  )
}

function SubjectRow({ children }: { children: React.ReactNode }) {
  return (
    <div className='flex items-center gap-2 border-b pb-2 text-xs'>
      <span className='shrink-0 text-muted-foreground'>Subject</span>
      <span className='truncate font-medium'>{children}</span>
    </div>
  )
}

/**
 * The three personalization visuals. Each is a slice of the real step editor
 * (`sequence-step-editor.tsx` / `sequence-body-editor.tsx` / the settings
 * drawer), not a generic illustration.
 */
export function MockStepEditor({
  variant,
  className,
}: {
  variant: StepEditorVariant
  className?: string
}) {
  return (
    <div className={cn('space-y-3', className)}>
      {variant === 'placeholders' && (
        <>
          <EditorShell>
            <SubjectRow>
              Your invoice <Token label='invoice.number' /> is due soon
            </SubjectRow>
            <div className='space-y-2 pt-2.5 text-xs leading-relaxed'>
              <p>
                Hi <Token label='contact.firstName' fallback='there' />,
              </p>
              <p className='text-muted-foreground'>
                A quick reminder that invoice <Token label='invoice.number' /> for{' '}
                <Token label='invoice.total' /> is due on <Token label='invoice.dueDate' />.
              </p>
              <p className='text-muted-foreground'>Let us know if you have any questions.</p>
            </div>
          </EditorShell>
          <div className='flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-[11px] text-muted-foreground'>
            <PenLine className='size-3.5 shrink-0' />
            Resolved per recipient at send time — empty fields fall back to what you set.
          </div>
        </>
      )}

      {variant === 'snippets' && (
        <>
          <EditorShell>
            <SubjectRow>How did everything go?</SubjectRow>
            <div className='space-y-2 pt-2.5 text-xs leading-relaxed'>
              <p>
                Hi <Token label='contact.firstName' fallback='there' />,
              </p>
              <p className='text-muted-foreground'>
                Thanks again for having us out for{' '}
                <Token label='work_order.title' fallback='your service' />.
              </p>
            </div>
            <div className='mt-3 flex flex-wrap items-center gap-1.5 border-t pt-2.5'>
              <span className='inline-flex items-center gap-1 rounded-md border px-1.5 py-1 text-[10px] text-muted-foreground'>
                <Plus className='size-3' />
                Insert snippet
              </span>
              <span className='inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-1 text-[10px]'>
                <Paperclip className='size-3' />
                service-report.pdf
              </span>
              <span className='inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-1 text-[10px]'>
                <Paperclip className='size-3' />
                warranty.pdf
              </span>
            </div>
          </EditorShell>
          <div className='flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-[11px] text-muted-foreground'>
            <Mails className='size-3.5 shrink-0' />
            Snippets and attachments are set per step, not per sequence.
          </div>
        </>
      )}

      {variant === 'sender' && (
        <EditorShell>
          <div className='space-y-3'>
            <div className='space-y-1.5'>
              <div className='text-[11px] font-medium text-muted-foreground'>Sending mailbox</div>
              <div className='flex items-center justify-between rounded-lg border px-2.5 py-2 text-xs'>
                <span className='flex items-center gap-2'>
                  <Mail className='size-3.5 text-muted-foreground' />
                  billing@northfield.co
                </span>
                <ChevronDown className='size-3.5 text-muted-foreground' />
              </div>
            </div>
            <div className='space-y-1.5'>
              <div className='text-[11px] font-medium text-muted-foreground'>Signature</div>
              <div className='flex items-center justify-between rounded-lg border px-2.5 py-2 text-xs'>
                <span>Northfield — Billing</span>
                <ChevronDown className='size-3.5 text-muted-foreground' />
              </div>
            </div>
            <div className='rounded-lg bg-muted/60 p-2.5 text-[11px] leading-relaxed text-muted-foreground'>
              <div className='font-medium text-foreground'>Sarah Whitfield</div>
              Northfield Mechanical · Billing
              <br />
              billing@northfield.co · (503) 555-0142
            </div>
          </div>
        </EditorShell>
      )}
    </div>
  )
}
