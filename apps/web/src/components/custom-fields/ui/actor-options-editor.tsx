// apps/web/src/components/custom-fields/ui/actor-options-editor.tsx
'use client'

import { Switch } from '@auxx/ui/components/switch'
import { Label } from '@auxx/ui/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { Card, CardContent, CardHeader, CardTitle } from '@auxx/ui/components/card'
import type { ActorFieldOptions } from '@auxx/types/field'
import type { FieldOptions } from '@auxx/lib/field-values/client'

// Re-export ActorFieldOptions for convenience
export type { ActorFieldOptions }

/** Human-readable labels for ActorTarget values */
const TARGET_OPTIONS = [
  { value: 'user', label: 'Users Only', description: 'Only organization members can be assigned' },
  { value: 'group', label: 'Groups Only', description: 'Only groups/teams can be assigned' },
  { value: 'both', label: 'Users & Groups', description: 'Both users and groups can be assigned' },
] as const

/** Human-readable labels for OrganizationRole */
const ROLE_OPTIONS = [
  { value: 'OWNER', label: 'Owner' },
  { value: 'ADMIN', label: 'Admin' },
  { value: 'USER', label: 'User' },
] as const

/** Default actor field options */
const DEFAULT_ACTOR_OPTIONS: ActorFieldOptions = {
  target: 'user',
  multiple: false,
}

/** Props for ActorOptionsEditor component */
export interface ActorOptionsEditorProps {
  options: ActorFieldOptions
  onChange: (options: ActorFieldOptions) => void
  mode: 'create' | 'edit'
}

/**
 * Editor component for configuring ACTOR field options.
 * Used within the CustomFieldDialog for ACTOR field type.
 */
export function ActorOptionsEditor({ options, onChange, mode }: ActorOptionsEditorProps) {
  const isEditMode = mode === 'edit'

  /** Update a single option field */
  const updateOption = <K extends keyof ActorFieldOptions>(
    key: K,
    value: ActorFieldOptions[K]
  ) => {
    onChange({ ...options, [key]: value })
  }

  /** Whether to show the roles filter (only when target includes users) */
  const showRolesFilter = options.target === 'user' || options.target === 'both'

  /** Whether to show the groups filter (only when target includes groups) */
  const showGroupsFilter = options.target === 'group' || options.target === 'both'

  /** Toggle a role in the roles array */
  const toggleRole = (role: 'OWNER' | 'ADMIN' | 'USER') => {
    const currentRoles = options.roles ?? []
    const newRoles = currentRoles.includes(role)
      ? currentRoles.filter((r) => r !== role)
      : [...currentRoles, role]
    updateOption('roles', newRoles.length > 0 ? newRoles : undefined)
  }

  return (
    <div className="space-y-4">
      {/* Target Selector */}
      <div className="space-y-2">
        <Label>Who can be assigned?</Label>
        <Select
          value={options.target}
          onValueChange={(v) => {
            updateOption('target', v as ActorFieldOptions['target'])
            // Clear roles/groupIds when target changes
            if (v === 'user') {
              updateOption('groupIds', undefined)
            } else if (v === 'group') {
              updateOption('roles', undefined)
            }
          }}
          disabled={isEditMode}>
          <SelectTrigger>
            <SelectValue placeholder="Select target type" />
          </SelectTrigger>
          <SelectContent>
            {TARGET_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                <div>
                  <span className="font-medium">{opt.label}</span>
                  <span className="text-xs text-muted-foreground ml-2">{opt.description}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isEditMode && (
          <p className="text-xs text-muted-foreground">
            Target type cannot be changed after field creation.
          </p>
        )}
      </div>

      {/* Multiple Switch */}
      <div className="flex items-center justify-between rounded-lg border px-4 py-3">
        <div className="space-y-0.5">
          <Label>Allow Multiple Selection</Label>
          <p className="text-xs text-muted-foreground">
            {options.multiple
              ? 'Multiple users/groups can be assigned'
              : 'Only one user/group can be assigned'}
          </p>
        </div>
        <Switch
          checked={options.multiple}
          onCheckedChange={(checked) => updateOption('multiple', checked)}
          disabled={isEditMode}
        />
      </div>
      {isEditMode && options.multiple !== undefined && (
        <p className="text-xs text-muted-foreground -mt-2 px-1">
          Selection mode cannot be changed after field creation.
        </p>
      )}

      {/* Roles Filter (optional) */}
      {showRolesFilter && (
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-medium">
              Limit to Roles (Optional)
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-xs text-muted-foreground mb-3">
              Leave unchecked to allow all roles
            </p>
            <div className="flex flex-wrap gap-4">
              {ROLE_OPTIONS.map((role) => (
                <label key={role.value} className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={options.roles?.includes(role.value) ?? false}
                    onCheckedChange={() => toggleRole(role.value)}
                  />
                  <span className="text-sm">{role.label}</span>
                </label>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Groups Filter (optional) - placeholder for future implementation */}
      {showGroupsFilter && (
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-medium">
              Limit to Groups (Optional)
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-xs text-muted-foreground">
              Group selection will be available in a future update.
              Currently, all accessible groups will be available for selection.
            </p>
            {/* TODO: Add group multi-select picker */}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

/** Default options for a new ACTOR field */
export function getDefaultActorOptions(): ActorFieldOptions {
  return { ...DEFAULT_ACTOR_OPTIONS }
}

/** Parse actor options from field options JSON */
export function parseActorOptions(options?: FieldOptions): ActorFieldOptions {
  if (!options?.actor || typeof options.actor !== 'object') {
    return getDefaultActorOptions()
  }
  const actor = options.actor as Record<string, unknown>
  return {
    target: (actor.target as ActorFieldOptions['target']) ?? 'user',
    multiple: (actor.multiple as boolean) ?? false,
    roles: actor.roles as ActorFieldOptions['roles'],
    groupIds: actor.groupIds as ActorFieldOptions['groupIds'],
  }
}

/** Format actor options for submission (wraps in { actor: ... }) */
export function formatActorOptions(options: ActorFieldOptions): { actor: ActorFieldOptions } {
  // Only include defined values
  const formatted: ActorFieldOptions = {
    target: options.target,
    multiple: options.multiple,
  }
  if (options.roles?.length) {
    formatted.roles = options.roles
  }
  if (options.groupIds?.length) {
    formatted.groupIds = options.groupIds
  }
  return { actor: formatted }
}
