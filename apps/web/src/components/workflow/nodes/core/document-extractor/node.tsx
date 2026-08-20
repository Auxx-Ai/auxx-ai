// apps/web/src/components/workflow/nodes/core/document-extractor/node.tsx

'use client'

import { FileText, Link } from 'lucide-react'
import { memo } from 'react'
import { BaseNode } from '~/components/workflow/nodes/shared/base/base-node'
import {
  hasFailBranch as hasFailBranchFor,
  NodeFailBranch,
} from '~/components/workflow/nodes/shared/node-fail-branch'
import type { NodeProps } from '~/components/workflow/types'
import { NodeSourceHandle, NodeTargetHandle } from '~/components/workflow/ui/node-handle'
import VariableTag from '~/components/workflow/ui/variables/variable-tag'
import { isNodeVariable } from '~/components/workflow/utils/variable-utils'
import { type DocumentExtractorNodeData, DocumentSourceType } from './types'

/**
 * Document Extractor node component for the workflow canvas
 * Displays source type and configured source (file/url) with VariableTag for variable references
 */
export const DocumentExtractorNode = memo<NodeProps<DocumentExtractorNodeData>>(
  ({ id, data, selected }) => {
    const isFileSource = data.sourceType === DocumentSourceType.FILE
    const sourceLabel = isFileSource ? 'File' : 'URL'
    const sourceValue = isFileSource ? data.fileId : data.url
    const hasSource = !!sourceValue

    // Check if source field is in variable mode
    const sourceField = isFileSource ? 'fileId' : 'url'
    const isSourceVariable =
      !data.fieldModes?.[sourceField] &&
      typeof sourceValue === 'string' &&
      isNodeVariable(sourceValue)

    // The fail lane renders off the STORED `error_strategy` — the same predicate
    // `connection.branches` uses, so the handle this renders and the branch the
    // catalog declares can never disagree. A node that predates the step-4
    // opt-in carries no key and renders exactly what it always did.
    const hasFailBranch = hasFailBranchFor(data)
    const totalSourceHandles = hasFailBranch ? 2 : 1
    const augmentedData = { ...data, _sourceHandleCount: totalSourceHandles }

    return (
      <BaseNode id={id} data={augmentedData} selected={selected} width={244} height='auto'>
        <NodeTargetHandle id={id} data={{ ...augmentedData, selected }} handleId='target' />
        <div className='space-y-1 pb-2'>
          <div className='relative px-2'>
            <div className='flex items-start justify-start rounded-md bg-primary-100 p-1'>
              <div className='flex h-4 shrink-0 items-center rounded-md px-1 text-xs font-semibold uppercase bg-accent-100 text-accent-500 gap-1'>
                {isFileSource ? <FileText className='h-3 w-3' /> : <Link className='h-3 w-3' />}
                {sourceLabel}
              </div>
            </div>

            {hasSource ? (
              <div className='flex items-center gap-1 text-xs text-muted-foreground mt-1'>
                <span>Source:</span>
                {isSourceVariable ? (
                  <VariableTag variableId={sourceValue} nodeId={id} />
                ) : (
                  <span className='font-mono text-primary-600 truncate max-w-[160px]'>
                    {sourceValue}
                  </span>
                )}
              </div>
            ) : (
              <div className='text-xs text-primary-400 mt-1'>Not configured</div>
            )}

            <NodeSourceHandle
              handleId='source'
              id={id}
              data={{ ...augmentedData, selected }}
              handleClassName='!bottom-5'
              handleIndex={0}
              handleTotal={totalSourceHandles}
            />
          </div>
          {hasFailBranch && <NodeFailBranch id={id} data={augmentedData} selected={selected} />}
        </div>
      </BaseNode>
    )
  }
)

DocumentExtractorNode.displayName = 'DocumentExtractorNode'
