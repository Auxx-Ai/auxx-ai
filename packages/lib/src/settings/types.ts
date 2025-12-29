// Create a type for your settings (settings.types.ts)
export interface UserSettings {
  theme: 'light' | 'dark' | 'system'
  font: 'inter' | 'manrope' | 'system'
  notifications: { email: boolean; push: boolean; marketing: boolean }
  shopify: { storeName: string; autoSync: boolean }
  displayMode: 'compact' | 'comfortable'
  timezone: string
  language: string
}
// export type UserSettingsKey = keyof UserSettings
export type NestedKeyOf<T> = {
  [K in keyof T & (string | number)]: T[K] extends object
    ? `${K}` | `${K}.${NestedKeyOf<T[K]>}`
    : `${K}`
}[keyof T & (string | number)]

export type UserSettingsPath = NestedKeyOf<UserSettings>

export const DEFAULT_USER_SETTINGS: UserSettings = {
  theme: 'system',
  font: 'system',
  notifications: { email: true, push: true, marketing: false },
  shopify: { storeName: '', autoSync: false },
  displayMode: 'comfortable',
  timezone: 'UTC',
  language: 'en',
}

export type Setting =
  | 'sidebar.inboxes'
  | 'sidebar.inboxOrder'
  | 'sidebar.personalItems'
  | 'sidebar.views'
  | 'sidebar.viewsOrder'
  | 'sidebar.groupVisibility'
  | 'appearance.logo'
  | 'appearance.primaryColor'
  | 'appearance.secondaryColor'
  | 'appearance.font'
  | 'notification.emailDigest'
  | 'dashboard.defaultView'
  | 'email.internalDomains'
  | 'email.partnerDomains'

export type GenericSetting<U extends Setting, T extends Record<string, unknown>> = {
  type: U
  data: T
}

export type SettingValue = string | number | boolean | object | null

// Settings configuration with metadata
export interface SettingConfig {
  key: string
  scope:
    | 'APPEARANCE'
    | 'NOTIFICATION'
    | 'DASHBOARD'
    | 'COMMUNICATION'
    | 'SECURITY'
    | 'INTEGRATION'
    | 'GENERAL'
    | 'SIDEBAR'
  defaultValue: SettingValue
  type: 'string' | 'number' | 'boolean' | 'object' | 'color' | 'font' | 'image'
  description?: string
  options?: Array<{ label: string; value: string | number | boolean }>
  organizationOnly?: boolean // New flag to indicate org-only settings
}

export type Settings = Record<Setting, SettingConfig>
