// Part of the Manufacturing app for managing parts and inventory
// ~/src/app/%28protected%29/app/parts/_components/part-list.tsx
'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, Search, Filter, MoreHorizontal, Edit, Trash2, FileText, Tag } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Badge } from '@auxx/ui/components/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { api } from '~/trpc/react'
import { CSVColumnMapper } from './column-mapper'
import type { PartEntity as Part, InventoryEntity as Inventory } from '@auxx/database/models'
type PartWithInventory = Part & {
  inventory?: Inventory | null
}
interface PartListProps {
  initialParts?: PartWithInventory[]
}
export function PartList({ initialParts = [] }: PartListProps) {
  const router = useRouter()
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  // Use React Query to fetch parts data
  const { data: partsData, refetch } = api.part.all.useQuery(
    {},
    { initialData: { parts: initialParts }, refetchOnWindowFocus: false }
  )
  const parts = partsData?.parts || []

  // Listen for routing events to detect when we return from the create form
  useEffect(() => {
    // Refetch parts data when component mounts or when router changes
    refetch()
  }, [refetch])
  const deletePart = api.part.delete.useMutation({
    onSuccess: () => {
      refetch() // Refetch parts data after successful deletion
      toastSuccess({ title: 'Part deleted successfully' })
    },
    onError: (error) => {
      toastError({ title: 'Error deleting part' })
    },
  })
  // Get unique categories for filter dropdown
  const categories = [...new Set(parts.map((part) => part.category).filter(Boolean))]
  // Filter parts based on search query and category
  const filteredParts = parts.filter((part) => {
    const matchesSearch =
      !searchQuery ||
      part.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      part.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (part.description && part.description.toLowerCase().includes(searchQuery.toLowerCase()))
    const matchesCategory =
      !categoryFilter || categoryFilter === 'all' || part.category === categoryFilter
    return matchesSearch && matchesCategory
  })
  // Delete part handler
  const handleDelete = async (id: string) => {
    try {
      await deletePart.mutateAsync({ id })
    } catch (error) {
      // Error handling is managed by the mutation callbacks
    }
  }
  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="font-semibold leading-none tracking-tight">Parts</div>
          <div className="text-sm text-muted-foreground">Manage your inventory parts</div>
        </div>
        <div className="flex items-center gap-2">
          <PartListDropdown onImportSuccess={() => refetch()} />
        </div>
      </div>
      <div className="mb-6 flex flex-col gap-4 md:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search parts..."
            className="pl-8"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex w-full items-center gap-2 md:w-auto">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-full md:w-44">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((category) => (
                <SelectItem key={category} value={category}>
                  {category}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Parts table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[300px]">Part Name</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Inventory</TableHead>
              <TableHead className="text-right"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredParts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  No parts found.
                </TableCell>
              </TableRow>
            ) : (
              filteredParts.map((part) => (
                <TableRow key={part.id}>
                  <TableCell className="font-medium">
                    <Link href={`/app/parts/${part.id}`} className="hover:underline">
                      {part.title}
                    </Link>
                  </TableCell>
                  <TableCell>{part.sku}</TableCell>
                  <TableCell>
                    {part.category ? (
                      <Badge variant="secondary">
                        <Tag className="mr-1 h-3 w-3" />
                        {part.category}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {part.inventory ? (
                      <span
                        className={`font-medium ${part.inventory.quantity <= (part.inventory.reorderPoint || 0) ? 'text-red-500' : ''}`}>
                        {part.inventory.quantity}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0">
                          <span className="sr-only">Open menu</span>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem asChild>
                          <Link href={`/app/parts/${part.id}`}>
                            <FileText />
                            View details
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link href={`/app/parts/${part.id}/edit`}>
                            <Edit />
                            Edit
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => handleDelete(part.id)}>
                          <Trash2 />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
function PartListDropdown({ onImportSuccess }: { onImportSuccess?: () => void }) {
  const [isOpen, setIsOpen] = useState(false)
  const router = useRouter()
  const calculateAllCosts = api.part.calculateAllCosts.useMutation({
    onSuccess: () => {
      toastSuccess({ title: 'Costs recalculated successfully' })
      if (onImportSuccess) onImportSuccess()
    },
    onError: (error) => {
      toastError({ title: 'Error recalculating costs' })
    },
  })
  async function handleCalculateAllCosts() {
    await calculateAllCosts.mutateAsync()
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon">
            <Plus />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Options</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem asChild>
              <Link href="/app/parts/create">Create Part</Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setIsOpen(true)}>Import Parts</DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              onClick={handleCalculateAllCosts}
              disabled={calculateAllCosts.isPending}>
              Recalculate Costs
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <CSVColumnMapper
        isOpen={isOpen}
        setIsOpen={setIsOpen}
        onDataImported={(data) => {
          console.log(data)
          if (onImportSuccess) onImportSuccess()
        }}
      />
    </>
  )
}
