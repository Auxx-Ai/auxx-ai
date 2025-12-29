// apps/web/src/components/datasets/search/search-result-item.tsx

'use client'

import { Card, CardContent } from '@auxx/ui/components/card'
import { Badge } from '@auxx/ui/components/badge'
import { FileText, Database, Hash } from 'lucide-react'
import { cn } from '@auxx/ui/lib/utils'

/**
 * Search result structure from backend
 * Matches the actual SearchResult type from @auxx/lib/datasets/types/search.types
 */
interface SearchResult {
  segment: {
    id: string
    content: string
    position: number
    startOffset?: number
    endOffset?: number
    tokenCount?: number
    document: {
      id: string
      title: string
      filename: string
      type?: string
      dataset?: {
        id: string
        name: string
      }
    }
    metadata?: Record<string, any>
    searchMetadata?: Record<string, any>
  }
  score: number
  rank: number
  highlights?: string[]
  distance?: number
  relevanceScore?: number
  searchType?: string
}

interface SearchResultItemProps {
  result: SearchResult
  index: number
  className?: string
  showMetadata?: boolean
  onSelect?: (result: SearchResult) => void
}

/**
 * Component to display a single search result with proper nested data structure
 */
export function SearchResultItem({
  result,
  index,
  className,
  showMetadata = true,
  onSelect,
}: SearchResultItemProps) {
  // Extract data from nested structure
  const segment = result.segment
  const document = segment?.document
  const dataset = document?.dataset

  // Determine display title
  const displayTitle = document?.title || document?.filename || `Result ${index + 1}`

  // Extract content with fallback
  const content = segment?.content || ''
  const hasContent = content.length > 0

  // Calculate score percentage
  const scorePercentage = (result.score * 100).toFixed(1)

  // Truncate content for preview (max 200 chars)
  const truncatedContent = content.length > 200 ? content.substring(0, 197) + '...' : content

  /**
   * Format highlights if available
   */
  const renderContent = () => {
    if (!hasContent) {
      return <p className="text-sm text-muted-foreground italic">No content preview available</p>
    }

    if (result.highlights && result.highlights.length > 0) {
      // If we have highlights, show the first one
      return <p className="text-sm text-muted-foreground line-clamp-3">{result.highlights[0]}</p>
    }

    // Otherwise show truncated content
    return <p className="text-sm text-muted-foreground line-clamp-3">{truncatedContent}</p>
  }

  /**
   * Render metadata section
   */
  const renderMetadata = () => {
    if (!showMetadata) return null

    const metadataItems = []

    // Add dataset info
    if (dataset?.name) {
      metadataItems.push(
        <div key="dataset" className="flex items-center gap-1">
          <Database className="size-3" />
          <span>Dataset: {dataset.name}</span>
        </div>
      )
    }

    // Add document type
    if (document?.type) {
      metadataItems.push(
        <div key="type" className="flex items-center gap-1">
          <FileText className="size-3" />
          <span>Type: {document.type}</span>
        </div>
      )
    }

    // Add segment position
    if (segment?.position !== undefined) {
      metadataItems.push(
        <div key="position" className="flex items-center gap-1">
          <Hash className="size-3" />
          <span>Segment: {segment.position + 1}</span>
        </div>
      )
    }

    // Add custom metadata
    const customMetadata = { ...segment?.metadata, ...segment?.searchMetadata }
    const customKeys = Object.keys(customMetadata).filter(
      (key) => !['documentId', 'documentTitle', 'filename', 'datasetName', 'position'].includes(key)
    )

    if (customKeys.length > 0) {
      customKeys.slice(0, 2).forEach((key) => {
        metadataItems.push(
          <div key={key} className="text-xs">
            {key}: {String(customMetadata[key])}
          </div>
        )
      })
    }

    if (metadataItems.length === 0) return null

    return <div className="text-xs text-muted-foreground hidden space-y-1">{metadataItems}</div>
  }

  /**
   * Get score badge variant based on score value
   */
  const getScoreBadgeVariant = (score: number): 'default' | 'secondary' | 'outline' => {
    if (score >= 0.8) return 'default'
    if (score >= 0.5) return 'secondary'
    return 'outline'
  }

  return (
    <Card
      className={cn(
        ' hover:bg-muted/50 transition-colors',
        onSelect && 'cursor-pointer',
        className
      )}
      onClick={() => onSelect?.(result)}>
      <CardContent className="p-2">
        <div className="space-y-2">
          {/* Header with title and score */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <h4 className="font-medium text-sm truncate" title={displayTitle}>
                {displayTitle}
              </h4>
              {document?.filename && document.filename !== displayTitle && (
                <p className="text-xs text-muted-foreground truncate" title={document.filename}>
                  {document.filename}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {result.searchType && (
                <Badge variant="outline" size="xs">
                  {result.searchType}
                </Badge>
              )}
              <Badge variant={getScoreBadgeVariant(result.score)} size="xs">
                {scorePercentage}%
              </Badge>
              {result.rank !== undefined && (
                <Badge variant="outline" size="xs">
                  #{result.rank + 1}
                </Badge>
              )}
            </div>
          </div>

          {/* Content preview */}
          {renderContent()}

          {/* Metadata section */}
          {renderMetadata()}
        </div>
      </CardContent>
    </Card>
  )
}
