// apps/web/src/components/kopilot/suggestions/types.ts

export type SuggestionIcon =
  | 'mail'
  | 'user'
  | 'file'
  | 'mic'
  | 'sparkle'
  | 'reply'
  | 'list'
  | 'plus'
  | 'history'
  | 'shopping-bag'
  | 'workflow'
  | 'pencil'
  | 'search'

/** What each `<KopilotSuggestion>` mount writes into the store. */
export interface SuggestionSlice {
  id: string
  text: string
  icon?: SuggestionIcon
  priority: number
  autoSubmit: boolean
}
