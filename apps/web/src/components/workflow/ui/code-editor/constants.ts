// apps/web/src/components/workflow/ui/code-editor/constants.ts

export const CODE_EDITOR_LINE_HEIGHT = 18
export const DEFAULT_MIN_HEIGHT = 100

export const DEFAULT_EDITOR_OPTIONS = {
  readOnly: false,
  domReadOnly: true,
  quickSuggestions: false,
  minimap: { enabled: false },
  lineNumbersMinChars: 1,
  wordWrap: 'on' as const,
  unicodeHighlight: { ambiguousCharacters: false },
  scrollBeyondLastLine: false,
  scrollbar: {
    vertical: 'auto' as const,
    horizontal: 'auto' as const,
    // verticalScrollbarSize: 8,
    // horizontalScrollbarSize: 8,
  },
  // Disable bracket guides on the right side
  guides: {
    bracketPairs: false,
    indentation: false,
  },
  overviewRulerLanes: 0,
  // hideCursorInOverviewRuler: true,
  // overviewRulerBorder: false,
}

/**
 * Enhanced editor options for workflows with completion support
 * Enables overflow widgets to extend beyond editor boundaries
 */
export const COMPLETION_EDITOR_OPTIONS = {
  ...DEFAULT_EDITOR_OPTIONS,
  fixedOverflowWidgets: true,
  // overflowWidgetsDomNode will be set dynamically
}
