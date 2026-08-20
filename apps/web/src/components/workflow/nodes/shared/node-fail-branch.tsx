// apps/web/src/components/workflow/nodes/shared/node-fail-branch.tsx

'use client'

import { hasFailBranch } from '@auxx/lib/workflow-engine/client'
import { NodeSourceHandle } from '~/components/workflow/ui/node-handle'

interface NodeFailBranchProps {
  /** Canvas node id. */
  id: string
  /** The node's data, already augmented with `_sourceHandleCount`. */
  data: Record<string, unknown>
  /** React Flow hands this back optional; the handle only needs the flag. */
  selected?: boolean
}

/**
 * The `fail` lane a node renders when its stored `error_strategy` is `fail`.
 *
 * One component for all eight types that can render it. http and crud each
 * carried a byte-identical copy of this block; step 4 added six more types that
 * would have made eight, and a rendered handle that drifts from what the
 * processor emits is the exact bug family the parity suite exists to catch
 * (plan 21 §7.4).
 *
 * Callers must render this SECOND (index 1 of 2) — the plain `source` handle is
 * always index 0 — and set `_sourceHandleCount` on the data they pass to
 * `BaseNode` so the collapsed-height calculation accounts for both.
 */
export function NodeFailBranch({ id, data, selected }: NodeFailBranchProps) {
  return (
    <div className='relative px-2'>
      <div className='flex items-center justify-between rounded-md bg-primary-100 p-1 text-xs'>
        <div className='h-4 rounded-md px-1 font-semibold uppercase bg-bad-100 text-bad-500 whitespace-pre-line'>
          On Failure
        </div>
        <div className='text-primary-500'>Fail Branch</div>
      </div>
      <NodeSourceHandle
        id={id}
        handleId='fail'
        type='fail'
        data={{ ...data, selected } as never}
        handleClassName='!bottom-5'
        handleIndex={1}
        handleTotal={2}
      />
    </div>
  )
}

/**
 * Whether this node's stored config selects the one policy that renders a lane.
 *
 * Re-exported from the catalog so a `node.tsx` never re-implements the
 * predicate: the handle this renders and the branch `connection.branches`
 * declares read the same function, so they cannot disagree.
 */
export { hasFailBranch }
