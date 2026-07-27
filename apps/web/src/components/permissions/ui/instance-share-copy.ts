// apps/web/src/components/permissions/ui/instance-share-copy.ts

import type { InstanceAccessKey } from '@auxx/lib/permissions/client'

/**
 * Per-resource UI copy for the generic {@link import('./instance-share-card').InstanceShareCard}
 * — the client mirror of the server's `INSTANCE_ACCESS_RESOURCES`. Everything
 * resource-specific about the Share card is DATA here, not code: adding KB /
 * dashboards later is one entry each, no new component (§4).
 */
export interface InstanceShareCopy {
  /** The resource noun, e.g. `'dataset'`. Used in inline copy. */
  noun: string
  /** The "everyone can use it by default" baseline line. */
  baselineHint: string
  /** What Read / Write / Full mean for this resource. */
  levels: { read: string; write: string; full: string }
}

/**
 * Copy keyed by {@link InstanceAccessKey}. Only the resources with an entry here
 * render a Share card — an unsupported def part narrows out to `null`.
 */
export const INSTANCE_SHARE_COPY: Record<InstanceAccessKey, InstanceShareCopy> = {
  dataset: {
    noun: 'dataset',
    baselineHint: 'Everyone in the workspace can use it in search and agents by default.',
    levels: {
      read: 'Use in search & agents',
      write: 'Add & manage files',
      full: 'Change settings',
    },
  },
  kb: {
    noun: 'knowledge base',
    baselineHint: 'Everyone in the workspace can read and write its articles by default.',
    levels: {
      read: 'Read articles',
      write: 'Write & publish articles',
      full: 'Manage the KB & its settings',
    },
  },
  dashboard: {
    noun: 'dashboard',
    baselineHint: 'Shared with the workspace by default. Restrict it to make it private.',
    levels: {
      read: 'View',
      write: 'Edit widgets & layout',
      full: 'Manage & delete',
    },
  },
}
