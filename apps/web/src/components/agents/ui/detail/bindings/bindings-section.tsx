// apps/web/src/components/agents/ui/detail/bindings/bindings-section.tsx
'use client'

import type { ToolBindingMap, VarSource } from '@auxx/lib/agents/bindings/client'
import { Button } from '@auxx/ui/components/button'
import { EmptySection, Section } from '@auxx/ui/components/section'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { pluralize } from '@auxx/utils/strings'
import { Plus, ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import type { AgentDetail } from '../../../store/agent-store'
import { AddBindingDialog } from './add-binding-dialog'
import { BindingRow } from './binding-row'
import { useBindings } from './hooks/use-bindings'
import { type ToolMeta, useToolMeta } from './hooks/use-tool-meta'

interface BindingsSectionProps {
  agent: AgentDetail
}

/** Render a binding's bound value as a short label for the row secondary. */
function valueLabelFor(source: VarSource, refLabelById: Map<string, string>): string {
  if (source.kind === 'var') {
    const ref = typeof source.ref === 'string' ? source.ref : source.ref.join(' → ')
    return refLabelById.get(ref) ?? ref
  }
  if (source.kind === 'const') {
    const v = source.value
    if (v === undefined || v === null) return 'unset constant'
    return typeof v === 'string' ? `"${v}"` : String(v)
  }
  return 'model decides'
}

/**
 * Bindings section — the per-agent **override** layer, grouped by tool. Owns the
 * `<Section>` shell (with the "Add override" action) and the add/edit dialog
 * state. Each enabled tool with ≥1 override is a parent `TreeRow`; child rows are
 * the per-input overrides. Most agents have none (author defaults cover the
 * common case). Disabled-tool entries are kept in the map but hidden. See
 * plans/chat/v8 phase-5.
 */
export function BindingsSection({ agent }: BindingsSectionProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<{ registeredName: string } | null>(null)
  const [, ConfirmDialog] = useConfirm()
  // Per-tool expand state, keyed by registered name. Tools default to collapsed;
  // an explicit `true` expands one.
  const [openTools, setOpenTools] = useState<Record<string, boolean>>({})

  const toolMeta = useToolMeta(agent)
  const { bindings, save } = useBindings(agent)
  const contact = api.agent.listBindingFields.useQuery({ anchor: 'contact' })
  const participant = api.agent.listBindingFields.useQuery({ anchor: 'participant' })
  const thread = api.agent.listBindingFields.useQuery({ anchor: 'thread' })

  const refLabelById = useMemo(() => {
    const map = new Map<string, string>()
    for (const q of [contact.data, participant.data, thread.data]) {
      for (const f of q?.fields ?? []) map.set(f.ref, f.label)
    }
    return map
  }, [contact.data, participant.data, thread.data])

  // Split overrides into enabled-tool entries (shown) vs disabled-tool entries
  // (kept inert, hidden — surfaced only as a count).
  const { enabledEntries, disabledCount } = useMemo(() => {
    const enabled: Array<[string, ToolMeta, Record<string, VarSource>]> = []
    let disabled = 0
    for (const [registeredName, perTool] of Object.entries(bindings)) {
      if (Object.keys(perTool).length === 0) continue
      const meta = toolMeta.byRegisteredName.get(registeredName)
      if (meta?.enabled) enabled.push([registeredName, meta, perTool])
      else disabled++
    }
    return { enabledEntries: enabled, disabledCount: disabled }
  }, [bindings, toolMeta.byRegisteredName])

  const handleSaveTool = async (registeredName: string, byArg: Record<string, VarSource>) => {
    const next: ToolBindingMap = { ...bindings }
    // Full-replace this tool's overrides; drop the key entirely when none left.
    if (Object.keys(byArg).length === 0) delete next[registeredName]
    else next[registeredName] = byArg
    await save(next)
  }

  const handleDelete = async (registeredName: string, arg: string) => {
    const next: ToolBindingMap = { ...bindings }
    const perTool = { ...(next[registeredName] ?? {}) }
    delete perTool[arg]
    if (Object.keys(perTool).length === 0) delete next[registeredName]
    else next[registeredName] = perTool
    await save(next)
  }

  const openEdit = (registeredName: string) => {
    setEditing({ registeredName })
    setDialogOpen(true)
  }

  const hasAny = enabledEntries.length > 0

  return (
    <Section
      title='Bindings'
      icon={<ShieldCheck className='size-4' />}
      className='[&>[data-slot=section]>[data-slot=section-content]]:-mx-3'
      initialOpen
      description='Tools are scoped by their built-in defaults. Override an input to pin a value or rebind it.'
      collapsible={false}
      actions={
        <Button
          variant='ghost'
          size='xs'
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}>
          <Plus />
          Add override
        </Button>
      }>
      {toolMeta.isLoading ? (
        <EmptySection loading className='mx-3' />
      ) : (
        <div className='space-y-3'>
          {!hasAny ? (
            <div className='px-3 py-2'>
              <EmptySection
                icon={<ShieldCheck className='size-5' />}
                title='No overrides'
                description='Tools are scoped by their built-in defaults. Add an override to pin or change an input.'
              />
            </div>
          ) : (
            <div className='flex flex-col ps-2 pe-4'>
              {enabledEntries.map(([registeredName, meta, perTool]) => {
                const count = Object.keys(perTool).length
                const isOpen = !!openTools[registeredName]
                return (
                  <TreeRow
                    key={registeredName}
                    icon={<AppIcon iconId={meta.iconId || 'wrench'} size='sm' />}
                    title={meta.displayName}
                    secondary={`${count} ${pluralize(count, 'override')}`}
                    expandable
                    isOpen={isOpen}
                    onToggleOpen={() =>
                      setOpenTools((prev) => ({ ...prev, [registeredName]: !prev[registeredName] }))
                    }>
                    {Object.entries(perTool).map(([arg, source]) => (
                      <BindingRow
                        key={arg}
                        arg={arg}
                        valueLabel={valueLabelFor(source, refLabelById)}
                        onEdit={() => openEdit(registeredName)}
                        onDelete={() => handleDelete(registeredName, arg)}
                      />
                    ))}
                  </TreeRow>
                )
              })}
            </div>
          )}

          {disabledCount > 0 ? (
            <p className='px-3 text-xs text-muted-foreground'>
              {disabledCount} {pluralize(disabledCount, 'override')} kept for disabled tools.
            </p>
          ) : null}

          <AddBindingDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            agent={agent}
            toolMeta={toolMeta}
            editing={editing}
            onSave={handleSaveTool}
          />
          <ConfirmDialog />
        </div>
      )}
    </Section>
  )
}
