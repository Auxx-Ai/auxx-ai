// apps/web/src/app/(protected)/app/tickets/settings/domains/page.tsx
'use client'

import { useState, useEffect } from 'react'
import { api } from '~/trpc/react'
import {
  MailIcon,
  Server,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Mail,
  Loader2,
  Globe,
  MoreVertical,
  Plus,
  Trash,
  Power,
  PowerOff,
} from 'lucide-react'
import SettingsPage from '~/components/global/settings-page'
import DomainTestingTab from '../../_components/domain-testing-tab'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { Separator } from '@auxx/ui/components/separator'
import { toastError } from '@auxx/ui/components/toast'
import { Alert, AlertTitle, AlertDescription } from '@auxx/ui/components/alert'
import { Badge } from '@auxx/ui/components/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { EntityIcon } from '@auxx/ui/components/icons'
import { EmptyState } from '~/components/global/empty-state'
import { useConfirm } from '~/hooks/use-confirm'

/** Props for AddDomainDialog */
interface AddDomainDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDomainRegistered: () => void
}

/** Dialog for adding a new domain */
function AddDomainDialog({ open, onOpenChange, onDomainRegistered }: AddDomainDialogProps) {
  const [subdomain, setSubdomain] = useState('')
  const [routingPrefix, setRoutingPrefix] = useState('ticket')
  const [isCheckingSubdomain, setIsCheckingSubdomain] = useState(false)

  const { data: providerInfo } = api.mailDomain.getProviderDomainInfo.useQuery()

  const { data: subdomainData, refetch: checkSubdomain } = api.mailDomain.checkSubdomain.useQuery(
    { subdomain },
    { enabled: false }
  )

  const registerDomain = api.mailDomain.registerProviderDomain.useMutation({
    onSuccess: () => {
      onDomainRegistered()
      onOpenChange(false)
      setSubdomain('')
      setRoutingPrefix('ticket')
    },
    onError: (error) => {
      toastError({
        title: 'Error registering domain',
        description: error.message,
      })
    },
  })

  // Check subdomain availability with debounce
  useEffect(() => {
    if (subdomain.length < 3) return

    setIsCheckingSubdomain(true)
    const timeout = setTimeout(() => {
      checkSubdomain().finally(() => setIsCheckingSubdomain(false))
    }, 500)

    return () => clearTimeout(timeout)
  }, [subdomain, checkSubdomain])

  /** Handle form submission */
  const handleRegister = async () => {
    if (!subdomain.trim() || subdomain.length < 3) {
      toastError({
        title: 'Subdomain required',
        description: 'Please enter a subdomain with at least 3 characters',
      })
      return
    }

    if (subdomainData && !subdomainData.isAvailable) {
      toastError({
        title: 'Subdomain unavailable',
        description: 'This subdomain is already taken. Please choose another one.',
      })
      return
    }

    await registerDomain.mutateAsync({
      subdomain: subdomain.trim(),
      routingPrefix,
    })
  }

  /** Format example email address */
  const formatExampleEmail = (domain: string, prefix: string = routingPrefix) => {
    return `${prefix}123@${domain}`
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" position="tc">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">Add Email Domain</DialogTitle>
          <DialogDescription>
            Get a subdomain on {providerInfo?.providerDomain || 'our domain'} with no DNS setup
            required
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="subdomain">Choose Your Subdomain</Label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Input
                  id="subdomain"
                  placeholder="your-company"
                  value={subdomain}
                  onChange={(e) => setSubdomain(e.target.value)}
                />
                {subdomain.length >= 3 && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    {isCheckingSubdomain ? (
                      <RefreshCw className="size-4 animate-spin text-muted-foreground" />
                    ) : subdomainData?.isAvailable ? (
                      <CheckCircle2 className="size-4 text-green-500" />
                    ) : (
                      <XCircle className="size-4 text-red-500" />
                    )}
                  </div>
                )}
              </div>
              <span className="whitespace-nowrap text-sm text-muted-foreground">
                .{providerInfo?.providerDomain || 'our-domain.com'}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              This will be your custom subdomain for receiving ticket emails
            </p>

            {subdomain.length >= 3 && subdomainData && !subdomainData.isAvailable && (
              <div className="mt-2 space-y-2">
                <p className="text-sm font-medium text-red-500">
                  This subdomain is already taken. Try one of these instead:
                </p>
                <div className="flex flex-wrap gap-2">
                  {subdomainData.suggestions.map((suggestion) => (
                    <Button
                      key={suggestion}
                      variant="outline"
                      size="sm"
                      onClick={() => setSubdomain(suggestion)}>
                      {suggestion}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <Separator />

          <div className="space-y-2">
            <Label htmlFor="routing-prefix">Email Prefix</Label>
            <Input
              id="routing-prefix"
              placeholder="ticket"
              value={routingPrefix}
              onChange={(e) => setRoutingPrefix(e.target.value)}
            />
            <p className="text-sm text-muted-foreground">
              Prefix for ticket emails. Example:{' '}
              {formatExampleEmail(
                `${subdomain || 'your-company'}.${providerInfo?.providerDomain || 'our-domain.com'}`
              )}
            </p>
          </div>

          <Alert variant="blue">
            <Mail className="size-4" />
            <AlertTitle>Ready immediately</AlertTitle>
            <AlertDescription>
              No DNS setup required. Your email address will be ready to use as soon as you
              register.
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleRegister}
            loading={registerDomain.isPending}
            loadingText="Registering..."
            disabled={subdomain.length < 3 || (subdomainData && !subdomainData.isAvailable)}>
            Register Subdomain
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Domain details card for existing domains */
function DomainDetailsCard({ domainId, onBack }: { domainId: string; onBack: () => void }) {
  return <DomainTestingTab domainId={domainId} onBack={onBack} />
}

/** Main domains page */
export default function MailDomainsPage() {
  const [selectedDomainId, setSelectedDomainId] = useState<string | null>(null)
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)

  const { data: domainsData, isLoading, refetch } = api.mailDomain.getDomains.useQuery()

  const hasDomains = domainsData?.domains && domainsData.domains.length > 0

  /** Handle successful domain registration */
  const handleDomainRegistered = () => {
    refetch()
  }

  /** Handle domain selection for details view */
  const handleSelectDomain = (domainId: string) => {
    setSelectedDomainId(domainId)
  }

  /** Handle back navigation from details view */
  const handleBack = () => {
    setSelectedDomainId(null)
  }

  return (
    <SettingsPage
      title="Email Domains"
      description="Set up your email domain to receive and send ticket emails."
      icon={<MailIcon />}
      breadcrumbs={[
        { title: 'Support Tickets', href: '/app/tickets' },
        { title: 'Settings', href: '/app/tickets/settings' },
        { title: 'Email Domain' },
      ]}>
      <div className="p-8 flex-col flex-1">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
          </div>
        ) : selectedDomainId ? (
          <DomainDetailsCard domainId={selectedDomainId} onBack={handleBack} />
        ) : !hasDomains ? (
          <div className=" flex-1 flex flex-col h-full items-center">
            <EmptyState
              icon={Globe}
              title="No email domains configured"
              description="Set up an email domain to start receiving and sending ticket emails."
              button={
                <Button onClick={() => setIsAddDialogOpen(true)}>
                  <Plus /> Add Your First Domain
                </Button>
              }
            />
          </div>
        ) : (
          <DomainsListView
            domains={domainsData.domains}
            onSelectDomain={handleSelectDomain}
            onRefetch={refetch}
            onAddDomain={() => setIsAddDialogOpen(true)}
          />
        )}
      </div>

      <AddDomainDialog
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
        onDomainRegistered={handleDomainRegistered}
      />
    </SettingsPage>
  )
}

/** Domain type for list view */
interface DomainItem {
  id: string
  domain: string
  routingPrefix: string
  isActive: boolean
}

/** Domains list view component */
function DomainsListView({
  domains,
  onSelectDomain,
  onRefetch,
  onAddDomain,
}: {
  domains: DomainItem[]
  onSelectDomain: (id: string) => void
  onRefetch: () => void
  onAddDomain: () => void
}) {
  const [confirm, ConfirmDialog] = useConfirm()

  const deleteDomain = api.mailDomain.deleteDomain.useMutation({
    onSuccess: () => {
      onRefetch()
    },
    onError: (error) => {
      toastError({ title: 'Error deleting domain', description: error.message })
    },
  })

  const updateDomain = api.mailDomain.updateDomain.useMutation({
    onSuccess: () => {
      onRefetch()
    },
    onError: (error) => {
      toastError({ title: 'Error updating domain', description: error.message })
    },
  })

  /** Handle domain deletion with confirmation */
  const handleDelete = async (domain: DomainItem) => {
    const confirmed = await confirm({
      title: `Delete ${domain.domain}?`,
      description:
        'This will permanently remove this domain. All associated email functionality will stop working.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      await deleteDomain.mutateAsync({ id: domain.id })
    }
  }

  /** Handle domain enable/disable toggle */
  const handleToggleActive = async (domainId: string, isActive: boolean) => {
    await updateDomain.mutateAsync({ id: domainId, isActive })
  }

  return (
    <div className="space-y-4">
      {/* Header with Add Button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 leading-none tracking-tight font-semibold text-foreground">
          <Globe className="size-4" /> Email Domains
        </div>
        <Button size="sm" onClick={onAddDomain}>
          <Plus /> Add Domain
        </Button>
      </div>

      {/* Domain List */}
      <div className="space-y-2">
        {domains.map((domain) => (
          <div
            key={domain.id}
            onClick={() => onSelectDomain(domain.id)}
            className="group flex items-center justify-between rounded-2xl border py-2 px-3 hover:bg-muted transition-colors duration-200 cursor-pointer">
            <div className="flex flex-row items-center gap-2">
              <EntityIcon iconId="mail" color="blue" variant="muted" />
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{domain.domain}</span>
                  <Badge size="xs" variant={domain.isActive ? 'green' : 'secondary'}>
                    {domain.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                <span className="text-xs text-muted-foreground">
                  Prefix: {domain.routingPrefix}
                </span>
              </div>
            </div>

            {/* Actions Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={(e) => e.stopPropagation()}>
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    handleToggleActive(domain.id, !domain.isActive)
                  }}
                  disabled={updateDomain.isPending}>
                  {domain.isActive ? (
                    <>
                      <PowerOff /> Disable
                    </>
                  ) : (
                    <>
                      <Power /> Enable
                    </>
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete(domain)
                  }}
                  disabled={deleteDomain.isPending}>
                  <Trash /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
      </div>

      <ConfirmDialog />
    </div>
  )
}
