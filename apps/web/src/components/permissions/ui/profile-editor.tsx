// apps/web/src/components/permissions/ui/profile-editor.tsx
'use client'

import { Area } from '@auxx/lib/permissions/client'
import { AutosizeInput, type AutosizeInputRef } from '@auxx/ui/components/autosize-input'
import { Button } from '@auxx/ui/components/button'
import { IconPicker } from '@auxx/ui/components/icon-picker'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { ChevronLeft, SlidersHorizontal } from 'lucide-react'
import { type KeyboardEvent, type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import { FormSaveBar } from '~/components/global/forms/form-save-bar'
import { SettingsSection } from '~/components/global/settings-page'
import { useConfirm } from '~/hooks/use-confirm'
import { useGranteeDefAccess } from '../hooks/use-grantee-def-access'
import { useInstanceGranteeRows } from '../hooks/use-instance-grantee-rows'
import { useProfileEditor } from '../hooks/use-profile-editor'
import type { PermissionProfile } from '../hooks/use-profiles'
import { AgentPolicyEditor } from './agent-policy-editor'
import { BaseLevelSelect } from './base-level-select'
import { GranteeDefAccessRows } from './grantee-def-access-rows'
import { GranteeInstanceRows } from './grantee-instance-rows'
import { AREA_TO_INSTANCE_KEY } from './instance-share-copy'
import type { AreaChildFilter, AreaChildren } from './leveled-area-grid'
import { ProfileAreaGrid } from './profile-area-grid'
import { DEFAULT_PROFILE_ICON } from './profile-copy'
import { ProfileSeatReference } from './profile-seat-reference'

interface ProfileEditorProps {
  profile: PermissionProfile
  /** The `granularPermissions` plan gate — reads are never gated, writes are. */
  canEdit: boolean
  onBack: () => void
}

/**
 * The human permission-profile editor (doc 19 §7, narrowed by plan 20 §2.a.1):
 * **identity + base access**, saved as **one** transactional mutation (§6.1.4),
 * because the server's escalation guard compares each affected holder's effective
 * state before and after inside a single transaction. A profile authors no cap of
 * its own — teams and personal grants only ever raise from the base.
 *
 * ALL of identity lives in the header strip — icon picker, name, and description,
 * the latter two always-live `AutosizeInput`s that read as text until you type in
 * them (`ProcedureDetailBar`'s idiom). Unlike that bar, though, every one of them
 * writes to the **draft** via `patch` and never fires a mutation of its own,
 * because of the one-transaction rule above. The bottom `FormSaveBar` is the only
 * thing that saves.
 *
 * Two things this screen deliberately does not offer:
 * - **The `owner` profile is not editable** (§0.10). It is the recovery guarantee:
 *   OWNER short-circuits before any clamp is consulted, so a mis-shaped profile is
 *   always fixable. Everything renders read-only.
 * - **`seat`, `appliesTo`, `slug` and `isSystem` are immutable** (§0.18): changing a
 *   profile's seat class under existing holders would break the billing invariant,
 *   so that is *clone and reassign*, never an edit here.
 */
export function ProfileEditor({ profile, canEdit, onBack }: ProfileEditorProps) {
  const {
    draft,
    patch,
    setAreaLevel,
    reset,
    save,
    isDirty,
    isSaving,
    isLoading,
    roleDefaults,
    agentPolicy,
  } = useProfileEditor(profile)
  const [confirm, ConfirmDialog] = useConfirm()
  const headerRef = useRef<HTMLDivElement>(null)
  const stickyTop = useStickyChromeOffset(headerRef)

  const isOwner = profile.slug === 'owner'
  const isAgentProfile = profile.appliesTo === 'agent'
  const editable = canEdit && !isOwner
  const icon = draft.icon ?? DEFAULT_PROFILE_ICON

  // Header rename (`ProcedureDetailBar`'s idiom): a local buffer so typing stays
  // smooth, re-seeded from the draft when it changes externally (hydration,
  // profile switch, Discard) but NEVER while focused — that would clobber an
  // in-progress edit.
  const nameInputRef = useRef<AutosizeInputRef>(null)
  const [nameValue, setNameValue] = useState(draft.name)
  const [nameFocused, setNameFocused] = useState(false)

  useEffect(() => {
    if (!nameFocused) setNameValue(draft.name)
  }, [draft.name, nameFocused])

  /** Commits to the DRAFT only — a profile saves in ONE transaction (§6.1.4). */
  const commitName = () => {
    const trimmed = nameValue.trim()
    // Empty is not a name (the save mutation would reject it) and unchanged is a
    // no-op — both revert rather than dirtying the draft.
    if (!trimmed || trimmed === draft.name) {
      setNameValue(draft.name)
      return
    }
    patch({ name: trimmed })
  }

  // Enter blurs rather than committing directly, so blur stays the single commit
  // path; Escape restores the draft value before blurring, so its commit no-ops.
  const handleNameKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      nameInputRef.current?.blur()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setNameValue(draft.name)
      nameInputRef.current?.blur()
    }
  }

  // Same idiom for the description, which shares the strip with the name.
  const descriptionInputRef = useRef<AutosizeInputRef>(null)
  const [descriptionValue, setDescriptionValue] = useState(draft.description)
  const [descriptionFocused, setDescriptionFocused] = useState(false)

  useEffect(() => {
    if (!descriptionFocused) setDescriptionValue(draft.description)
  }, [draft.description, descriptionFocused])

  /**
   * Commits to the DRAFT only. Unlike the name, an empty value IS meaningful — it
   * clears the description — so only an unchanged value reverts. `ProfileDraft`
   * types `description` as a plain string; `useProfileEditor.save()` is what maps
   * `''` to the wire's `null`.
   */
  const commitDescription = () => {
    const trimmed = descriptionValue.trim()
    if (trimmed === draft.description) {
      setDescriptionValue(draft.description)
      return
    }
    patch({ description: trimmed })
  }

  const handleDescriptionKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      descriptionInputRef.current?.blur()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setDescriptionValue(draft.description)
      descriptionInputRef.current?.blur()
    }
  }

  // Per-def overrides nested under Records, and per-instance grants nested
  // under Datasets / Knowledge base / Dashboards — this profile's OWN
  // `ResourceAccess` rows (`granteeType: 'profile'`), user requirement:
  // "expand Records and set the permissions for Companies", combined into
  // this same grid (not a separate section). Called unconditionally (rules of
  // hooks) even for an agent profile, which never renders `ProfileAreaGrid`.
  const {
    isLoading: defAccessLoading,
    rows: defRows,
    setLevel: setDefLevel,
  } = useGranteeDefAccess('profile', profile.id, {
    levels: draft.levels,
    baseLevel: draft.baseLevel,
  })
  const {
    isLoading: instanceRowsLoadingAll,
    lists: instanceLists,
    rowsByKey: instanceRowsByKey,
    setGrant: setInstanceGrant,
  } = useInstanceGranteeRows('profile', profile.id)

  /**
   * `ProfileAreaGrid`'s `renderChildren` — the profile-authoring twin of
   * `grantee-levels-section.tsx`'s host-owned `renderChildren` (capability
   * layer v2 Part B). A profile is a level SOURCE, not a subject
   * (`resourceAccess.forInstance`'s doc comment), so the per-instance rows never
   * show the dead-grant warning — this host passes no `deadGrantTooltip` at all.
   */
  const renderChildren = useCallback(
    (area: Area, filter: AreaChildFilter): AreaChildren | undefined => {
      if (area === Area.records) {
        if (defAccessLoading)
          return {
            matchCount: 0,
            rows: (
              <GranteeDefAccessRows rows={[]} isLoading canEdit={editable} onChange={setDefLevel} />
            ),
          }

        const matched = defRows.filter((row) => {
          if (filter.overridesOnly && row.grantLevel === undefined) return false
          if (!filter.query) return true
          const { plural, label } = row.resource
          return (
            plural.toLowerCase().includes(filter.query) ||
            label.toLowerCase().includes(filter.query)
          )
        })

        return {
          matchCount: matched.length,
          rows: <GranteeDefAccessRows rows={matched} canEdit={editable} onChange={setDefLevel} />,
        }
      }

      const instanceKey = AREA_TO_INSTANCE_KEY[area]
      if (!instanceKey) return undefined

      const instanceLoading = instanceRowsLoadingAll || instanceLists[instanceKey].isLoading
      if (instanceLoading)
        return {
          matchCount: 0,
          rows: (
            <GranteeInstanceRows
              rows={[]}
              isLoading
              canEdit={editable}
              onChange={setInstanceGrant}
            />
          ),
        }

      const matched = instanceRowsByKey[instanceKey].filter((row) => {
        if (filter.overridesOnly && row.grantLevel === undefined) return false
        if (!filter.query) return true
        return row.name.toLowerCase().includes(filter.query)
      })

      return {
        matchCount: matched.length,
        rows: (
          <GranteeInstanceRows
            rows={matched}
            truncated={instanceLists[instanceKey].truncated}
            canEdit={editable}
            onChange={setInstanceGrant}
          />
        ),
      }
    },
    [
      defAccessLoading,
      defRows,
      editable,
      setDefLevel,
      instanceRowsLoadingAll,
      instanceLists,
      instanceRowsByKey,
      setInstanceGrant,
    ]
  )

  const handleDiscard = async () => {
    const confirmed = await confirm({
      title: 'Discard changes?',
      description: 'Your unsaved changes to this profile will be lost.',
      confirmText: 'Discard',
      cancelText: 'Keep editing',
      destructive: true,
    })
    if (confirmed) reset()
  }

  return (
    <div className='flex flex-1 flex-col'>
      <ConfirmDialog />

      {/*
        Sticky so Back stays reachable while scrolling a long area grid. `top` is
        measured, not hardcoded: `SettingsPage` pins its own title + tab strip at
        the top of the same scroll viewport and that block's height changes with
        the breakpoint (its description wraps on narrow screens).
      */}
      <div
        ref={headerRef}
        style={{ top: stickyTop }}
        className='sticky z-10 flex h-9 shrink-0 items-center gap-2 border-b bg-primary-150 px-2'>
        <Button
          variant='ghost'
          size='icon-xs'
          className='shrink-0 rounded-md'
          aria-label='Back to profiles'
          onClick={onBack}>
          <ChevronLeft />
        </Button>

        {editable ? (
          <IconPicker
            value={{ icon: icon.iconId, color: icon.color }}
            onChange={(value) => patch({ icon: { iconId: value.icon, color: value.color } })}
            modal={false}>
            <button type='button' aria-label='Pick profile icon' className='shrink-0'>
              <EntityIcon iconId={icon.iconId} color={icon.color} size='sm' />
            </button>
          </IconPicker>
        ) : (
          <EntityIcon iconId={icon.iconId} color={icon.color} size='sm' className='shrink-0' />
        )}

        {editable ? (
          <AutosizeInput
            ref={nameInputRef}
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onFocus={() => setNameFocused(true)}
            onBlur={() => {
              setNameFocused(false)
              commitName()
            }}
            onKeyDown={handleNameKeyDown}
            placeholder='Profile name'
            className='shrink-0'
            inputClassName='text-sm font-medium text-foreground bg-transparent outline-none truncate placeholder:text-muted-foreground'
            minWidth={40}
            maxWidth={240}
          />
        ) : (
          <span className='shrink-0 truncate text-sm font-medium'>
            {draft.name || profile.name}
          </span>
        )}

        {/* Immutable (§0.18) — the one place the stable slug stays visible. */}
        <span className='shrink-0 font-mono text-xs text-muted-foreground'>@{profile.slug}</span>

        {/*
          The description takes whatever is left of the strip. `inputStyle.width`
          overrides `AutosizeInput`'s measured width on purpose: here we want a
          remainder-filling box that truncates, not a grow-to-content one, so it
          yields before the name (`shrink-0`) and the slug (`shrink-0`) do.
        */}
        {editable ? (
          <AutosizeInput
            ref={descriptionInputRef}
            value={descriptionValue}
            onChange={(e) => setDescriptionValue(e.target.value)}
            onFocus={() => setDescriptionFocused(true)}
            onBlur={() => {
              setDescriptionFocused(false)
              commitDescription()
            }}
            onKeyDown={handleDescriptionKeyDown}
            placeholder='Add a description'
            className='min-w-0 flex-1'
            inputStyle={{ width: '100%' }}
            inputClassName='w-full truncate bg-transparent text-xs text-muted-foreground outline-none placeholder:text-muted-foreground'
          />
        ) : draft.description ? (
          <span className='min-w-0 flex-1 truncate text-xs text-muted-foreground'>
            {draft.description}
          </span>
        ) : null}
      </div>

      <div className='flex flex-1 flex-col gap-8 p-3 sm:p-6'>
        {isOwner && (
          <div className='rounded-xl border border-dashed p-4 text-sm text-muted-foreground'>
            The Owner profile is fixed. Owners bypass every permission check by design. That bypass
            is what guarantees a mis-shaped profile can always be repaired, so this profile carries
            no levels of its own.
          </div>
        )}

        {!canEdit && !isOwner && (
          <div className='rounded-xl border border-dashed p-4 text-sm text-muted-foreground'>
            Profiles are read-only on your plan. Upgrade to granular permissions to edit them. The
            system profiles below still supply everyone's access in the meantime.
          </div>
        )}

        {profile.seat === 'worker' && <ProfileSeatReference />}

        {isAgentProfile ? (
          // An agent profile has no additive base — its rules are exact (SET
          // semantics) and live in `agentPolicy`, with their own save path. Never
          // render the human base map for one.
          <AgentPolicyEditor profileId={profile.id} savedPolicy={agentPolicy} readOnly={!canEdit} />
        ) : isLoading || !roleDefaults ? (
          <div className='space-y-2'>
            <Skeleton className='h-16 w-full rounded-lg' />
            <Skeleton className='h-16 w-full rounded-lg' />
          </div>
        ) : (
          <SettingsSection
            icon={SlidersHorizontal}
            title='Base access'
            description='Where a holder starts. Teams and personal grants can raise from here, never lower it.'
            // Gated on `isOwner`, NOT on `editable`: for an un-entitled plan the
            // select still reports a real fall-through value, but the Owner
            // profile carries no levels at all — offering the control there
            // contradicts the callout above.
            action={
              isOwner ? undefined : (
                <BaseLevelSelect
                  label='Unset areas fall through to'
                  allowUnset
                  value={draft.baseLevel}
                  disabled={!editable}
                  onChange={(baseLevel) => patch({ baseLevel })}
                />
              )
            }>
            <ProfileAreaGrid
              values={draft.levels}
              roleDefaults={roleDefaults}
              baseLevel={draft.baseLevel}
              seat={profile.seat}
              profileRole={profile.role}
              disabled={!editable}
              onChange={setAreaLevel}
              renderChildren={renderChildren}
            />
          </SettingsSection>
        )}

        {/*
          `dirty` drives visibility, so a read-only profile (owner / un-entitled
          plan) never sees the bar at all. `isLoading` stays in `saveDisabled`:
          the payload carries the WHOLE profile (§6.1.4), so submitting before
          `getProfile` lands would write a half-loaded draft.
        */}
        <FormSaveBar
          dirty={isDirty}
          isSaving={isSaving}
          onSave={() => void save()}
          onDiscard={() => void handleDiscard()}
          label='Unsaved profile changes'
          saveDisabled={!editable || isLoading}
        />
      </div>
    </div>
  )
}

/**
 * Height of the sticky chrome already pinned at the top of the enclosing
 * `ScrollArea` viewport (`SettingsPage`'s title block + tab strip), so a nested
 * sticky header can offset past it instead of hiding underneath it.
 *
 * Measured rather than hardcoded because that block's height is breakpoint- and
 * content-dependent. Returns `0` when the editor is not inside a scroll area, so
 * the header simply pins to the top.
 */
function useStickyChromeOffset(ref: RefObject<HTMLElement | null>): number {
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    const el = ref.current
    const viewport = el?.closest<HTMLElement>('[data-slot="scroll-area-viewport"]')
    const content = viewport?.firstElementChild as HTMLElement | null | undefined
    if (!el || !content) return

    // This editor's own branch of the scroll content — everything sticky before
    // it is chrome we have to clear.
    let branch: HTMLElement = el
    while (branch.parentElement && branch.parentElement !== content) branch = branch.parentElement
    if (branch.parentElement !== content) return

    const measure = () => {
      let total = 0
      for (const node of Array.from(content.children)) {
        if (node === branch) break
        if (getComputedStyle(node).position === 'sticky')
          total += node.getBoundingClientRect().height
      }
      setOffset(total)
    }

    const observer = new ResizeObserver(measure)
    observer.observe(content)
    return () => observer.disconnect()
  }, [ref])

  return offset
}
