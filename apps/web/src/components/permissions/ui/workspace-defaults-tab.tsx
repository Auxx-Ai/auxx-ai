// apps/web/src/components/permissions/ui/workspace-defaults-tab.tsx
'use client'

import { INSTANCE_ACCESS_KEYS, type InstanceAccessKey } from '@auxx/lib/permissions/client'
import { Badge } from '@auxx/ui/components/badge'
import { ButtonSwitch } from '@auxx/ui/components/button-switch'
import { InputSearch } from '@auxx/ui/components/input-search'
import { EmptySection } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { Shapes, SlidersHorizontal } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { FormSaveBar } from '~/components/global/forms/form-save-bar'
import { useConfirm } from '~/hooks/use-confirm'
import { useDefBaselines } from '../hooks/use-def-baselines'
import type { InstanceAreaAccess } from '../hooks/use-instance-baseline-rows'
import { useInstanceBaselineRows } from '../hooks/use-instance-baseline-rows'
import { mergeStaged } from '../hooks/use-staged-edits'
import { AreaAccessRow, hasAreaAccessRow } from './area-access-row'
import { DefBaselineRows } from './def-baseline-rows'
import { InstanceBaselineRows } from './instance-baseline-rows'
import { INSTANCE_TYPE_META } from './instance-share-copy'

/** One expandable collection of workspace-default rows. */
interface Collection {
  id: string
  label: string
  icon: ReactNode
  description: string
  /** Rows surviving the live filter; `0` while the collection is still loading. */
  matchCount: number
  /** Rows carrying an explicit `role:org_member` row of their own. */
  configuredCount: number
  rows: ReactNode
}

const RECORDS_ID = 'records'

/**
 * **Workspace defaults** — the org-wide `role:org_member` `ResourceAccess` rows:
 * one default per CRM record type, dataset, knowledge base, dashboard and
 * workflow (capability layer v2 Layer 3 / Part B, plan 16's aggregate view).
 *
 * "Everyone gets view on this dataset" is ONE row here, not N rows rewritten on
 * every profile create — which is why this tier survives while the
 * `role:org_member` `PermissionGrant` tier it was named after does not.
 *
 * This tab deliberately carries **no area-level grid**. Member area levels are
 * the `member` permission profile's `PermissionGrant` row, edited in exactly one
 * place — Profiles → Member — because that save is the only path that runs the
 * doc 19 §6.1 escalation guard over the resulting state of every PROFILE holder.
 * The grid that used to live here wrote per-area through `setGranteeLevels`,
 * which at the time ran no guard at all, so it could reach a state the profile
 * editor refuses. Plan 37 has since put the same guard on `setGranteeLevels`'
 * `user` tier, but that does not reopen this grid: a profile base moves every
 * holder at once, which is the comparison `savePermissionProfile` owns.
 *
 * Each row's **Inherit** option still names what it falls through to (the Member
 * profile's level for that area, or No Access for resources born private), so
 * removing the parent level control costs no information at the row.
 *
 * Plan 43 §5.2 puts that fall-through ON the screen: each instance collection is
 * headed by a **read-only** {@link AreaAccessRow} showing the Member profile's
 * rung for the area — see {@link areaAccessLeadingRow} for why read-only is the
 * only shape that does not reopen the hole this tab's missing grid closed.
 *
 * Both lanes STAGE their edits and commit from one {@link FormSaveBar}, matching
 * the profile editor next door — see `useStagedEdits` for why every grid on this
 * page now works that way.
 */
export function WorkspaceDefaultsTab({ disabled = false }: { disabled?: boolean }) {
  const defBaselines = useDefBaselines()
  const instanceBaselines = useInstanceBaselineRows()
  const { isLoading: defsLoading, rows: defRows, setBaseline: setDefBaseline } = defBaselines
  const {
    isLoading: instanceRowsLoadingAll,
    lists: instanceLists,
    rowsByKey: instanceRowsByKey,
    areaAccessByKey,
    setBaseline: setInstanceBaseline,
  } = instanceBaselines

  // The two lanes write different endpoints but read as one grid, so they share
  // one Save bar (plan: staged edits everywhere, `useStagedEdits`).
  const staged = mergeStaged([defBaselines, instanceBaselines])
  const [confirmDiscard, ConfirmDialog] = useConfirm()

  const [search, setSearch] = useState('')
  const [configuredOnly, setConfiguredOnly] = useState(false)
  /** Explicit expand state per collection; absent = follow `autoOpen`. */
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({})

  const query = search.trim().toLowerCase()

  const collections = useMemo<Collection[]>(() => {
    const out: Collection[] = []

    /** A collection whose own label matched shows every row; else the query narrows them. */
    const labelMatched = (label: string) => !query || label.toLowerCase().includes(query)

    const recordsLabel = 'Record types'
    if (defsLoading) {
      out.push({
        id: RECORDS_ID,
        label: recordsLabel,
        icon: <Shapes className='size-4' />,
        description: RECORDS_DESCRIPTION,
        matchCount: 0,
        configuredCount: 0,
        rows: <DefBaselineRows rows={[]} isLoading onChange={setDefBaseline} />,
      })
    } else {
      const showAll = labelMatched(recordsLabel)
      const matched = defRows.filter((row) => {
        if (configuredOnly && row.baselineLevel === undefined) return false
        if (showAll) return true
        const { plural, label } = row.resource
        return plural.toLowerCase().includes(query) || label.toLowerCase().includes(query)
      })
      out.push({
        id: RECORDS_ID,
        label: recordsLabel,
        icon: <Shapes className='size-4' />,
        description: RECORDS_DESCRIPTION,
        matchCount: matched.length,
        configuredCount: defRows.filter((row) => row.baselineLevel !== undefined).length,
        rows: <DefBaselineRows rows={matched} disabled={disabled} onChange={setDefBaseline} />,
      })
    }

    for (const key of INSTANCE_ACCESS_KEYS) {
      const meta = INSTANCE_TYPE_META[key]
      const Icon = meta.icon
      const accessRow = areaAccessLeadingRow(key, areaAccessByKey[key])
      const loading = instanceRowsLoadingAll || instanceLists[key].isLoading
      if (loading) {
        out.push({
          id: key,
          label: meta.label,
          icon: <Icon className='size-4' />,
          description: instanceDescription(key),
          matchCount: 0,
          configuredCount: 0,
          rows: (
            <InstanceBaselineRows
              rows={[]}
              isLoading
              leadingRow={accessRow}
              onChange={setInstanceBaseline}
            />
          ),
        })
        continue
      }

      const all = instanceRowsByKey[key]
      const showAll = labelMatched(meta.label)
      const matched = all.filter((row) => {
        if (configuredOnly && row.baselineLevel === undefined) return false
        if (showAll) return true
        return row.name.toLowerCase().includes(query)
      })
      out.push({
        id: key,
        label: meta.label,
        icon: <Icon className='size-4' />,
        description: instanceDescription(key),
        matchCount: matched.length,
        configuredCount: all.filter((row) => row.baselineLevel !== undefined).length,
        rows: (
          <InstanceBaselineRows
            rows={matched}
            truncated={instanceLists[key].truncated}
            disabled={disabled}
            leadingRow={accessRow}
            onChange={setInstanceBaseline}
          />
        ),
      })
    }

    return out
  }, [
    query,
    configuredOnly,
    defsLoading,
    defRows,
    disabled,
    setDefBaseline,
    instanceRowsLoadingAll,
    instanceLists,
    instanceRowsByKey,
    areaAccessByKey,
    setInstanceBaseline,
  ])

  /**
   * A collection survives when its own label matched, or when at least one of
   * its rows did. Under a live query the latter also auto-expands it — the rows
   * are the whole point of a search here.
   */
  const visible = useMemo(
    () =>
      collections
        .map((collection) => ({
          collection,
          selfMatch: !query || collection.label.toLowerCase().includes(query),
        }))
        .filter(({ collection, selfMatch }) => {
          if (configuredOnly && collection.matchCount === 0) return false
          return selfMatch || collection.matchCount > 0
        })
        .map(({ collection, selfMatch }) => ({
          collection,
          autoOpen: (!selfMatch || configuredOnly) && collection.matchCount > 0,
        })),
    [collections, query, configuredOnly]
  )

  if (defsLoading && instanceRowsLoadingAll) {
    return (
      <div className='space-y-2 p-3 sm:p-6'>
        <Skeleton className='h-24 w-full rounded-lg' />
        <Skeleton className='h-24 w-full rounded-lg' />
      </div>
    )
  }

  const handleDiscard = async () => {
    const confirmed = await confirmDiscard({
      title: 'Discard changes?',
      description: 'Your unsaved workspace defaults will be lost.',
      confirmText: 'Discard',
      cancelText: 'Keep editing',
      destructive: true,
    })
    if (confirmed) staged.discard()
  }

  return (
    <div className='flex flex-1 flex-col gap-3 p-3 sm:p-6'>
      <ConfirmDialog />
      <p className='max-w-2xl text-sm text-muted-foreground'>
        What every member gets on each individual record type, dataset, knowledge base, dashboard
        and workflow. Leave an item on Inherit to follow the Member profile, or set an explicit
        default — including No Access, which restricts the item to the people you share it with.
        Area-wide levels live on Profiles → Member.
      </p>

      <div className='flex items-center gap-2'>
        <InputSearch
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder='Search record types, datasets, knowledge bases...'
        />
        <ButtonSwitch
          label='Configured only'
          checked={configuredOnly}
          onCheckedChange={setConfiguredOnly}
        />
      </div>

      {visible.length === 0 ? (
        <EmptySection
          orientation='horizontal'
          icon={<SlidersHorizontal />}
          title='No matches'
          description='Nothing matches your search.'
        />
      ) : (
        <div className='flex flex-col gap-0.5'>
          {visible.map(({ collection, autoOpen }) => {
            const isOpen = openIds[collection.id] ?? autoOpen
            return (
              <TreeRow
                key={collection.id}
                rowClassName='bg-primary-50 hover:bg-primary-100'
                icon={collection.icon}
                title={collection.label}
                description={collection.description}
                expandable
                isOpen={isOpen}
                onToggleOpen={() => setOpenIds((prev) => ({ ...prev, [collection.id]: !isOpen }))}
                trailing={
                  collection.configuredCount > 0 ? (
                    <Badge variant='secondary' size='xs'>
                      {collection.configuredCount} set
                    </Badge>
                  ) : undefined
                }>
                {collection.rows}
              </TreeRow>
            )
          })}
        </div>
      )}

      {/*
        `dirty` drives visibility, so a read-only org (no `granularPermissions`)
        never sees the bar — its selects are disabled and nothing can stage.
      */}
      <FormSaveBar
        dirty={staged.isDirty}
        isSaving={staged.isSaving}
        onSave={() => void staged.save()}
        onDiscard={() => void handleDiscard()}
        label='Unsaved workspace defaults'
        saveDisabled={disabled}
      />
    </div>
  )
}

/** Where the area rung is authored — this tab shows it, Profiles → Member sets it. */
const AREA_ACCESS_READ_ONLY_NOTE =
  'Set on Profiles → Member: an area level moves every holder of that profile at once, so it saves through the one path that runs the escalation guard.'

/**
 * Plan 43's access row as this tab renders it: **read-only** (§5.2, fourth grid).
 *
 * Why it is here at all: every `Inherit · <level>` in the collection below points
 * at the area rung, and before this the rung was not on the screen. That is the
 * exact defect decision 0.7 exists to fix — the reader had to know the
 * containment rule to follow the label.
 *
 * Why it is READ-ONLY, and this is not a hedge: this tab deliberately carries no
 * area-level grid, because the grid that used to live here wrote per-area through
 * `setGranteeLevels` and could reach a state `savePermissionProfile` refuses (see
 * {@link WorkspaceDefaultsTab}). A writable access row would reintroduce that path
 * one row lower, and its `values[area]` write has no profile to guard. Showing the
 * value and naming where it is set keeps §8 item 19's promise — the same profile
 * reads the same on all four grids — without reopening the hole.
 *
 * `personal_inbox` is skipped. Its collection is empty by construction (a personal
 * mailbox has no workspace default), and `Area.inboxes`' own copy says in so many
 * words that personal mailboxes are never covered by the rung — so an "Inbox
 * access" row heading that collection would contradict itself.
 */
function areaAccessLeadingRow(key: InstanceAccessKey, access: InstanceAreaAccess | undefined) {
  if (key === 'personal_inbox' || !access || !hasAreaAccessRow(access.area)) return undefined
  return (
    <AreaAccessRow
      area={access.area}
      value={access.value}
      inheritedLevel={access.inherited}
      descriptionNote={AREA_ACCESS_READ_ONLY_NOTE}
      disabled
      onChange={() => {}}
    />
  )
}

const RECORDS_DESCRIPTION =
  'The default access every member gets to each CRM record type. Inherit follows the Records ' +
  'level on their permission profile; No Access restricts the type to explicit grantees.'

/** Per-resource line for a collection row — the instance twin of {@link RECORDS_DESCRIPTION}. */
function instanceDescription(key: InstanceAccessKey): string {
  return `The default access every member gets to each ${NOUNS[key]}. Expand an item to see or change who else can reach it.`
}

const NOUNS: Record<InstanceAccessKey, string> = {
  dataset: 'dataset',
  kb: 'knowledge base',
  dashboard: 'dashboard',
  workflow: 'workflow',
  agent: 'agent',
  signature: 'signature',
  snippet: 'snippet',
  inbox: 'inbox',
  // Listed for map totality only — the Personal inboxes collection renders
  // empty by construction (`use-instance-resource-lists.ts`), because a personal
  // mailbox has no workspace default to set.
  personal_inbox: 'personal inbox',
}
