// apps/web/src/components/workflow/nodes/core/http/components/auth-dialog.tsx

import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Label } from '@auxx/ui/components/label'
import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import { Key, LockKeyhole, Settings, ShieldOff, UserCheck } from 'lucide-react'
import { useState } from 'react'
import { BaseType, VAR_MODE } from '~/components/workflow/types'
import { VarEditor, VarEditorField } from '~/components/workflow/ui/input-editor/var-editor'
import { type Authorization, AuthType } from '../types'

interface AuthDialogProps {
  authorization: Authorization
  nodeId: string
  onChange: (auth: Authorization) => void
}

const authTypeItems = [
  {
    type: AuthType.none,
    title: 'No Auth',
    description: 'No authentication required',
    icon: ShieldOff,
  },
  {
    type: AuthType.basic,
    title: 'Basic Auth',
    description: 'Username and password authentication',
    icon: UserCheck,
  },
  {
    type: AuthType.bearer,
    title: 'Bearer Token',
    description: 'Token-based authentication',
    icon: Key,
  },
  {
    type: AuthType.custom,
    title: 'Custom Header',
    description: 'Custom authorization header',
    icon: Settings,
  },
]

export function AuthDialog({ authorization, nodeId, onChange }: AuthDialogProps) {
  const [open, setOpen] = useState(false)
  const [selectedType, setSelectedType] = useState<AuthType>(authorization.type)
  const [formData, setFormData] = useState<Authorization>(authorization)

  const handleTypeChange = (type: string) => {
    const authType = type as AuthType
    setSelectedType(authType)

    // Reset form data when changing auth type
    setFormData({
      type: authType,
      username: authType === AuthType.basic ? formData.username : undefined,
      password: authType === AuthType.basic ? formData.password : undefined,
      token:
        authType === AuthType.bearer || authType === AuthType.custom ? formData.token : undefined,
      header: authType === AuthType.custom ? formData.header : undefined,
    })
  }

  const handleSave = () => {
    onChange(formData)
    setOpen(false)
  }

  const getAuthButtonText = () => {
    switch (authorization.type) {
      case AuthType.basic:
        return 'Authentication: Basic'
      case AuthType.bearer:
        return 'Authentication: Bearer'
      case AuthType.custom:
        return 'Authentication: Custom'
      default:
        return 'Authentication: None'
    }
  }

  const renderAuthFields = () => {
    switch (selectedType) {
      case AuthType.basic:
        return (
          <div className='space-y-4 pt-4'>
            <div className='space-y-2'>
              <Label htmlFor='username'>Username</Label>
              <VarEditorField>
                <VarEditor
                  nodeId={nodeId}
                  value={formData.username || ''}
                  onChange={(value) => setFormData({ ...formData, username: value as string })}
                  varType={BaseType.STRING}
                  allowedTypes={[BaseType.STRING]}
                  mode={VAR_MODE.PICKER}
                  placeholder='Select variable'
                  placeholderConstant='Enter username'
                  allowConstant
                />
              </VarEditorField>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='password'>Password</Label>
              <VarEditorField>
                <VarEditor
                  nodeId={nodeId}
                  value={formData.password || ''}
                  onChange={(value) => setFormData({ ...formData, password: value as string })}
                  varType={BaseType.STRING}
                  allowedTypes={[BaseType.STRING]}
                  mode={VAR_MODE.PICKER}
                  placeholder='Select variable'
                  placeholderConstant='Enter password'
                  allowConstant
                />
              </VarEditorField>
            </div>
          </div>
        )

      case AuthType.bearer:
        return (
          <div className='space-y-2 pt-4'>
            <Label htmlFor='token'>Bearer Token</Label>
            <VarEditorField>
              <VarEditor
                nodeId={nodeId}
                value={formData.token || ''}
                onChange={(value) => setFormData({ ...formData, token: value as string })}
                varType={BaseType.STRING}
                allowedTypes={[BaseType.STRING]}
                mode={VAR_MODE.PICKER}
                placeholder='Select variable'
                placeholderConstant='Enter bearer token'
                allowConstant
              />
            </VarEditorField>
          </div>
        )

      case AuthType.custom:
        return (
          <div className='space-y-4 pt-4'>
            <div className='space-y-2'>
              <Label htmlFor='header'>Header Name</Label>
              <VarEditorField>
                <VarEditor
                  nodeId={nodeId}
                  value={formData.header || ''}
                  onChange={(value) => setFormData({ ...formData, header: value as string })}
                  varType={BaseType.STRING}
                  allowedTypes={[BaseType.STRING]}
                  mode={VAR_MODE.PICKER}
                  placeholder='Select variable'
                  placeholderConstant='e.g., X-API-Key'
                  allowConstant
                />
              </VarEditorField>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='custom-token'>API Key</Label>
              <VarEditorField>
                <VarEditor
                  nodeId={nodeId}
                  value={formData.token || ''}
                  onChange={(value) => setFormData({ ...formData, token: value as string })}
                  varType={BaseType.STRING}
                  allowedTypes={[BaseType.STRING]}
                  mode={VAR_MODE.RICH}
                  placeholder='Select variable'
                  placeholderConstant='Enter API key'
                  allowConstant
                />
              </VarEditorField>
            </div>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant='ghost' size='xs'>
          <LockKeyhole />
          {getAuthButtonText()}
        </Button>
      </DialogTrigger>
      <DialogContent size='sm' position='tc'>
        <DialogHeader>
          <DialogTitle>Authentication</DialogTitle>
          <DialogDescription>Configure authentication for your HTTP request.</DialogDescription>
        </DialogHeader>

        <RadioGroup className='gap-2' value={selectedType} onValueChange={handleTypeChange}>
          {authTypeItems.map((item) => (
            <RadioGroupItemCard
              key={item.type}
              value={item.type}
              id={`${item.type}-item`}
              label={item.title}
              description={item.description}
              icon={<item.icon />}
            />
          ))}
        </RadioGroup>

        {selectedType !== AuthType.none && <div className=''>{renderAuthFields()}</div>}

        <DialogFooter>
          <Button variant='ghost' size='sm' onClick={() => setOpen(false)}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button variant='outline' size='sm' onClick={handleSave} data-dialog-submit>
            Save <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
