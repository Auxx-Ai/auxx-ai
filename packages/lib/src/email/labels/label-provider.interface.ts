// lib/email/providers/label-provider.interface.ts
export interface ProviderLabel {
  id: string // Provider's native ID for the label
  name: string
  type?: string // system or user
  color?: string
  backgroundColor?: string
  textColor?: string
  visible?: boolean
  providerSpecificData?: any // For storing any provider-specific attributes
}

export interface LabelProvider {
  getLabels(): Promise<ProviderLabel[]>
  createLabel(label: Omit<ProviderLabel, 'id'>): Promise<ProviderLabel>
  updateLabel(id: string, label: Partial<ProviderLabel>): Promise<ProviderLabel>
  deleteLabel(id: string): Promise<boolean>
  syncLabels(): Promise<ProviderLabel[]>

  // Thread-related operations
  addLabelToThread(labelId: string, threadId: string): Promise<boolean>
  removeLabelFromThread(labelId: string, threadId: string): Promise<boolean>
}
