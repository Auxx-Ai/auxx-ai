// apps/web/src/components/permissions/ui/area-access-row.tsx
'use client'

import type { ResourcePermission } from '@auxx/database/enums'
import {
  type Area,
  clampLevelToArea,
  INSTANCE_ACCESS_KEYS,
  INSTANCE_ACCESS_RESOURCES,
  Level,
  PERMISSION_AREAS,
} from '@auxx/lib/permissions/client'
import { ACCESS_ROW_DEPTH, AccessRowSelect, AccessTreeRow } from './access-tree-row'
import { AREA_ACCESS_ROW_COPY } from './area-access-copy'
import { LEVEL_OF_PERMISSION, permissionOfLevel } from './level-labels'

/**
 * The eight areas that expand into per-instance rows — **derived from
 * `INSTANCE_ACCESS_RESOURCES`, never listed** (plan 43 §5.2).
 *
 * #1361 is the precedent: the `ALWAYS_OPEN` maps beside it were hand-written and
 * silently missed `agent` when it joined the registry, leaving an area row
 * expanding into an empty list. A hand-written copy of this set would fail the
 * same way, except louder — a new instance-access resource would keep the
 * parent's ladder while every other one lost it, which is exactly the "same
 * visual, different meaning" defect this plan exists to remove.
 *
 * Nine resources, eight areas: `inbox` and `personal_inbox` share `Area.inboxes`
 * (`instance-access.ts` spends 35 lines on why one key could not serve both).
 */
export const INSTANCE_ACCESS_AREAS: ReadonlySet<Area> = new Set(
  INSTANCE_ACCESS_KEYS.map((key) => INSTANCE_ACCESS_RESOURCES[key].area)
)

/**
 * Whether `area` renders an access child row instead of a control on its header.
 *
 * Both conditions are required and neither is redundant: the registry decides
 * which areas HAVE instance rows, and {@link AREA_ACCESS_ROW_COPY} decides which
 * of them have a sentence to put on the row. A new instance-access resource
 * therefore keeps its ladder — visibly unconverted — until someone writes its
 * copy, rather than rendering a controlless header above an unlabelled row.
 */
export function hasAreaAccessRow(area: Area): boolean {
  return INSTANCE_ACCESS_AREAS.has(area) && AREA_ACCESS_ROW_COPY[area] !== undefined
}

/**
 * The options an area's access row offers: `No access` plus exactly the rungs the
 * area declares — 4 for `datasets` / `knowledgeBase` / `workflows` / `agents`,
 * 3 for `inboxes`, 3 for `signatures` / `snippets` / `dashboards` (§3.1).
 *
 * Derived from `PERMISSION_AREAS[area].rungs`, **not** from `POSITIVE_LEVELS`,
 * so dropping or adding a rung in the registry lands here with no map to keep in
 * sync. `POSITIVE_LEVELS` itself is deliberately left alone (§5.4): an instance
 * row must keep offering `Read+write` even where the area has no `Edit` rung.
 */
export function areaAccessLevels(area: Area): ResourcePermission[] {
  return [Level.None, ...PERMISSION_AREAS[area].rungs.map((rung) => rung.level)].map(
    permissionOfLevel
  )
}

/**
 * The synthetic **access child row** — first child of every instance-access area
 * row, ahead of the instance rows (plan 43 §5.2, decision 0.7).
 *
 * It is not an instance and has no `ResourceAccess` row of its own: it reads and
 * writes `levels[area]`, the exact value the parent's `LevelControl` used to
 * carry. Moving the control down one level is the whole point — the parent asked
 * *"may I create"* while its children asked *"who may use this one"*, two
 * unrelated axes wearing the same ladder and stacked to imply a containment that
 * did not exist (§1.4).
 *
 * Two things fall out of the move, and both are why it is a row rather than a
 * relabelled header control:
 *
 * - **`Inherit` finally points at something.** On a dataset row it used to mean
 *   "fall through to the control rendered as my visual SIBLING one level up".
 *   Now the thing it inherits from is the row directly above it, in the same
 *   column, in the same control.
 * - **"Not set" is a first-class option.** `ProfileAreaRow` expressed absence
 *   with bespoke three-state logic because a segmented ladder has no absent
 *   position; `includeInherit` + `inheritedLevel` already models it, and renders
 *   `Inherit · Read only` against an explicit `No access` so §0.5(A)'s
 *   distinction is legible in the trigger.
 *
 * `Area.records` never gets one (§5.2): its children are per-*definition*, its
 * rung genuinely IS their default, and it has no `INSTANCE_ACCESS_RESOURCES`
 * entry. Expect a Records row and a Datasets row to look different in the same
 * grid — they behave differently.
 */
export function AreaAccessRow({
  area,
  value,
  inheritedLevel,
  inheritLabelText,
  descriptionNote,
  depth = ACCESS_ROW_DEPTH,
  disabled = false,
  onChange,
}: {
  area: Area
  /** The stored `levels[area]`, or `undefined` when the area falls through. */
  value: Level | undefined
  /** What an unset area resolves to — the profile base, then the role default. */
  inheritedLevel: Level
  /** Name for the fall-through option. The agent policy passes `'Default'`. */
  inheritLabelText?: string
  /** Appended to the static copy — the read-only surfaces say where to change it. */
  descriptionNote?: string
  depth?: number
  disabled?: boolean
  /** `undefined` clears the area back to its fall-through. */
  onChange: (level: Level | undefined) => void
}) {
  const copy = AREA_ACCESS_ROW_COPY[area]
  if (!copy) return null

  // Clamp both ends to the area's own ladder, the same way `LevelControl` clamps
  // its highlighted segment: a legacy `Level.Edit` stored against an area that no
  // longer has that rung (§3.1) composes DOWN to `Read`, and a blanket base above
  // the top rung resolves to the top rung. Rendering either verbatim would match
  // no option and silently fall back to displaying "Inherit" over a stored value.
  const stored = value === undefined ? undefined : clampLevelToArea(area, value)
  const inherited = clampLevelToArea(area, inheritedLevel)

  return (
    <AccessTreeRow
      depth={depth}
      title={copy.label}
      description={descriptionNote ? `${copy.description} ${descriptionNote}` : copy.description}
      actions={
        <AccessRowSelect
          area={area}
          levels={areaAccessLevels(area)}
          value={stored === undefined ? undefined : permissionOfLevel(stored)}
          includeInherit
          includeNone
          inheritedLevel={permissionOfLevel(inherited)}
          inheritLabelText={inheritLabelText}
          onInherit={() => onChange(undefined)}
          onChange={(permission) => onChange(LEVEL_OF_PERMISSION[permission])}
          disabled={disabled}
        />
      }
    />
  )
}
