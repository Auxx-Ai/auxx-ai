// apps/web/src/components/permissions/ui/instance-truncation-note.tsx

/**
 * The "there are more of these than we listed" line for the per-instance rows on
 * the Workspace defaults and grantee grids (plan 31 §2.6 / finding 5).
 *
 * `useInstanceResourceLists` fetches one page per resource type and reports
 * `truncated`, but only the agent-policy grid ever consumed it — the other two
 * surfaces silently showed the first page, and their host's search box matched
 * only within it. Shared by both so the two surfaces cannot drift on the one
 * sentence whose whole job is to stop the grid implying it is complete.
 *
 * Rendered next to the empty state too: "No matches" on a truncated list is the
 * same lie in a louder voice.
 */
export function InstanceTruncationNote() {
  return (
    <p className='px-1 py-1 text-xs text-muted-foreground'>
      Showing the first page only. Set access for anything not listed here from that item’s own
      page.
    </p>
  )
}
