// apps/web/src/components/workflow/nodes/core/document-extractor/node.tsx

'use client'

import { memo } from 'react'
import { BaseNode } from '~/components/workflow/nodes/shared/base/base-node'
import { NodeSourceHandle, NodeTargetHandle } from '~/components/workflow/ui/node-handle'
import {
  type DocumentExtractorNode as DocumentExtractorNodeType,
  DocumentSourceType,
} from './types'
import { FileText, Link } from 'lucide-react'
import VariableTag from '~/components/workflow/ui/variables/variable-tag'
import { isNodeVariable } from '~/components/workflow/utils/variable-utils'

/**
 * Document Extractor node component for the workflow canvas
 * Displays source type and configured source (file/url) with VariableTag for variable references
 */
export const DocumentExtractorNode = memo<DocumentExtractorNodeType>(({ id, data, selected }) => {
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

  return (
    <BaseNode id={id} data={data} selected={selected} width={244} height="auto">
      <NodeTargetHandle id={id} data={{ ...data, selected }} handleId="target" />
      <div className="space-y-1 pb-2">
        <div className="relative px-2">
          <div className="flex items-start justify-start rounded-md bg-primary-100 p-1">
            <div className="flex h-4 shrink-0 items-center rounded-md px-1 text-xs font-semibold uppercase bg-accent-100 text-accent-500 gap-1">
              {isFileSource ? <FileText className="h-3 w-3" /> : <Link className="h-3 w-3" />}
              {sourceLabel}
            </div>
          </div>

          {hasSource ? (
            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
              <span>Source:</span>
              {isSourceVariable ? (
                <VariableTag variableId={sourceValue} nodeId={id} />
              ) : (
                <span className="font-mono text-primary-600 truncate max-w-[160px]">
                  {sourceValue}
                </span>
              )}
            </div>
          ) : (
            <div className="text-xs text-primary-400 mt-1">Not configured</div>
          )}

          <NodeSourceHandle
            handleId="source"
            id={id}
            data={{ ...data, selected }}
            handleClassName="!bottom-5"
            handleIndex={0}
            handleTotal={1}
          />
        </div>
      </div>
    </BaseNode>
  )
})

DocumentExtractorNode.displayName = 'DocumentExtractorNode'
