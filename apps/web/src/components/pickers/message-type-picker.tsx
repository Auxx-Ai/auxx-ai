// apps/web/src/components/pickers/message-type-picker.tsx
'use client'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { MessageType } from '@auxx/database/enums'
import { Mail, MessageSquare, Phone, Video, FileText, Bell, Users } from 'lucide-react'

/**
 * Message type options for the picker
 */
const MESSAGE_TYPE_OPTIONS = [
  { value: MessageType.EMAIL, label: 'Email', description: 'Email messages', icon: Mail },
  { value: MessageType.CHAT, label: 'Chat', description: 'Chat messages', icon: MessageSquare },
  { value: MessageType.SMS, label: 'SMS', description: 'Text messages', icon: Phone },
  { value: MessageType.VOICE, label: 'Voice', description: 'Voice calls', icon: Video },
  { value: MessageType.NOTE, label: 'Note', description: 'Internal notes', icon: FileText },
  { value: MessageType.NOTIFICATION, label: 'Notification', description: 'System notifications', icon: Bell },
  { value: MessageType.SOCIAL, label: 'Social', description: 'Social media messages', icon: Users },
]
interface MessageTypePickerProps {
  value: MessageType | undefined
  onChange: (value: MessageType) => void
  placeholder?: string
  className?: string
  size?: 'default' | 'sm' | null
}
export function MessageTypePicker({
  value,
  onChange,
  placeholder = 'Select message type',
  ...props
}: MessageTypePickerProps) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger {...props}>
        <SelectValue placeholder={placeholder}>
          {MESSAGE_TYPE_OPTIONS.find((type) => type.value === value)?.label ?? value}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {MESSAGE_TYPE_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <div className="flex items-center gap-2">
              <option.icon className="h-4 w-4" />
              <div className="text-left">
                <div className="font-medium">{option.label}</div>
                <div className="text-xs text-muted-foreground">{option.description}</div>
              </div>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
