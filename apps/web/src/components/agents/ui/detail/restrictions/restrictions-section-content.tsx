// apps/web/src/components/agents/ui/detail/restrictions/restrictions-section-content.tsx
'use client'

import type { ArgRestriction, ToolRestrictionMap } from '@auxx/lib/agents/restrictions/client'
import { EmptySection } from '@auxx/ui/components/section'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { pluralize } from '@auxx/utils/strings'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { useMemo } from 'react'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { Tooltip } from '~/components/global/tooltip'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import type { AgentDetail } from '../../../store/agent-store'
import { AddRestrictionDialog } from './add-restriction-dialog'
import { useRestrictions } from './hooks/use-restrictions'
import { type ToolMeta, useToolMeta } from './hooks/use-tool-meta'
import { RestrictionRow } from './restriction-row'

interface RestrictionsSectionContentProps {
  agent: AgentDetail
  /** Controlled add/edit dialog open state — the "Add restriction" trigger lives in `<Section actions>`. */
  dialogOpen: boolean
  onDialogOpenChange: (open: boolean) => void
  /** Which restriction is being edited (`null` ⇒ adding a new one). */
  editing: { registeredName: string; arg: string } | null
  onEditingChange: (editing: { registeredName: string; arg: string } | null) => void
}

/** Render a restriction's bound value as a short label for the row secondary. */
function valueLabelFor(restriction: ArgRestriction, varLabelById: Map<string, string>): string {
  if (restriction.source === 'var') {
    return restriction.var ? (varLabelById.get(restriction.var) ?? restriction.var) : 'unset var'
  }
  if (restriction.source === 'constant') {
    const v = restriction.value
    if (v === undefined || v === null) return 'unset constant'
    return typeof v === 'string' ? `"${v}"` : String(v)
  }
  return 'model'
}

/**
 * Restrictions section — grouped by tool. Each enabled tool with ≥1
 * restriction is a parent `TreeRow`; child rows are the per-arg restrictions.
 * A top warning banner + per-tool `AlertTriangle` flag any chat-kind tool whose
 * identity arg is unbound (fail-closed). Disabled-tool entries are kept in the
 * map but hidden. See plans/chat/v6 phase-4.
 */
export function RestrictionsSectionContent({
  agent,
  dialogOpen,
  onDialogOpenChange,
  editing,
  onEditingChange,
}: RestrictionsSectionContentProps) {
  const [confirm, ConfirmDialog] = useConfirm()

  const toolMeta = useToolMeta(agent)
  const { restrictions, save } = useRestrictions(agent)
  const varsQuery = api.agent.listRestrictionVars.useQuery({ agentId: agent.id })

  const varLabelById = useMemo(() => {
    const map = new Map<string, string>()
    for (const v of varsQuery.data?.vars ?? []) map.set(v.id, v.label)
    return map
  }, [varsQuery.data])

  // Split kept restrictions into enabled-tool entries (shown) vs disabled-tool
  // entries (kept inert, hidden — surfaced only as a count).
  const { enabledEntries, disabledCount } = useMemo(() => {
    const enabled: Array<[string, ToolMeta, Record<string, ArgRestriction>]> = []
    let disabled = 0
    for (const [registeredName, perTool] of Object.entries(restrictions)) {
      if (Object.keys(perTool).length === 0) continue
      const meta = toolMeta.byRegisteredName.get(registeredName)
      if (meta?.enabled) enabled.push([registeredName, meta, perTool])
      else disabled++
    }
    return { enabledEntries: enabled, disabledCount: disabled }
  }, [restrictions, toolMeta.byRegisteredName])

  // Fail-closed warnings: chat-kind tool with an identity arg NOT bound.
  const unboundIdentityByTool = useMemo(() => {
    const map = new Map<string, string[]>()
    if (agent.kind !== 'chat') return map
    for (const meta of toolMeta.byRegisteredName.values()) {
      if (!meta.enabled || meta.identityScopedInputs.length === 0) continue
      const perTool = restrictions[meta.registeredName] ?? {}
      const unbound = meta.identityScopedInputs
        .map((i) => i.name)
        .filter((name) => {
          const r = perTool[name]
          return !r || r.source === 'model'
        })
      if (unbound.length > 0) map.set(meta.registeredName, unbound)
    }
    return map
  }, [agent.kind, toolMeta.byRegisteredName, restrictions])

  const bannerWarnings = useMemo(
    () =>
      [...unboundIdentityByTool.entries()].flatMap(([registeredName, args]) => {
        const meta = toolMeta.byRegisteredName.get(registeredName)
        return args.map((arg) => ({
          tool: meta?.displayName ?? registeredName,
          arg,
        }))
      }),
    [unboundIdentityByTool, toolMeta.byRegisteredName]
  )

  const handleSaveOne = async (
    registeredName: string,
    arg: string,
    restriction: ArgRestriction
  ) => {
    const next: ToolRestrictionMap = { ...restrictions }
    next[registeredName] = { ...(next[registeredName] ?? {}), [arg]: restriction }
    await save(next)
  }

  const handleDelete = async (registeredName: string, arg: string, isIdentityArg: boolean) => {
    if (isIdentityArg) {
      const confirmed = await confirm({
        title: 'Remove this restriction?',
        description:
          'Removing this lets the model choose the value; chat calls will refuse instead.',
        confirmText: 'Remove',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (!confirmed) return
    }
    const next: ToolRestrictionMap = { ...restrictions }
    const perTool = { ...(next[registeredName] ?? {}) }
    delete perTool[arg]
    if (Object.keys(perTool).length === 0) delete next[registeredName]
    else next[registeredName] = perTool
    await save(next)
  }

  const openEdit = (registeredName: string, arg: string) => {
    onEditingChange({ registeredName, arg })
    onDialogOpenChange(true)
  }

  const editingRestriction = editing
    ? restrictions[editing.registeredName]?.[editing.arg]
    : undefined

  if (toolMeta.isLoading) {
    return <EmptySection loading className='mx-3' />
  }

  const hasAny = enabledEntries.length > 0

  return (
    <div className='space-y-3'>
      {bannerWarnings.length > 0 ? (
        <div className='mx-3 flex flex-col gap-1 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2'>
          {bannerWarnings.map((w) => (
            <div
              key={`${w.tool}:${w.arg}`}
              className='flex items-center gap-2 text-xs text-destructive'>
              <AlertTriangle className='size-3 shrink-0' />
              <span>
                {w.tool} will refuse in chat until <code>{w.arg}</code> is bound.
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {!hasAny ? (
        <div className='px-3 py-2'>
          <EmptySection
            icon={<ShieldCheck className='size-5' />}
            title='No restrictions yet'
            description='Lock tool arguments to keep this agent scoped.'
          />
        </div>
      ) : (
        <div className='flex flex-col pe-4'>
          {enabledEntries.map(([registeredName, meta, perTool]) => {
            const unbound = unboundIdentityByTool.get(registeredName)
            const count = Object.keys(perTool).length
            return (
              <TreeRow
                key={registeredName}
                icon={<AppIcon iconId={meta.iconId || 'wrench'} size='sm' />}
                title={
                  <span className='inline-flex items-center gap-1'>
                    {meta.displayName}
                    {unbound && unbound.length > 0 ? (
                      <Tooltip content={`Unbound identity arg: ${unbound.join(', ')}`}>
                        <span className='inline-flex'>
                          <AlertTriangle className='size-3 text-destructive' />
                        </span>
                      </Tooltip>
                    ) : null}
                  </span>
                }
                secondary={`${count} ${pluralize(count, 'restriction')}`}
                expandable
                isOpen
                onToggleOpen={() => {}}>
                {Object.entries(perTool).map(([arg, restriction]) => {
                  const isIdentityArg = meta.identityScopedInputs.some((i) => i.name === arg)
                  return (
                    <RestrictionRow
                      key={arg}
                      arg={arg}
                      restriction={restriction}
                      valueLabel={valueLabelFor(restriction, varLabelById)}
                      isIdentityArg={isIdentityArg}
                      onEdit={() => openEdit(registeredName, arg)}
                      onDelete={() => handleDelete(registeredName, arg, isIdentityArg)}
                    />
                  )
                })}
              </TreeRow>
            )
          })}
        </div>
      )}

      {disabledCount > 0 ? (
        <p className='px-3 text-xs text-muted-foreground'>
          {disabledCount} {pluralize(disabledCount, 'restriction')} kept for disabled tools.
        </p>
      ) : null}

      <AddRestrictionDialog
        open={dialogOpen}
        onOpenChange={onDialogOpenChange}
        agent={agent}
        toolMeta={toolMeta}
        editing={editing}
        editingRestriction={editingRestriction}
        onSave={handleSaveOne}
      />
      <ConfirmDialog />
    </div>
  )
}
