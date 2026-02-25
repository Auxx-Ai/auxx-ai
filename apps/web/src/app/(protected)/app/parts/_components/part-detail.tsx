'use client'
import type { PartEntity as Part, SubpartEntity as Subpart } from '@auxx/database/types'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Separator } from '@auxx/ui/components/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { pluralize } from '@auxx/utils'
import { formatCurrency } from '@auxx/utils/currency'
import {
  ArrowLeft,
  Blocks,
  Edit,
  MoreHorizontal,
  MoreVertical,
  Package,
  PlusCircle,
  Store,
  Tag,
  Trash2,
  Truck,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { useState } from 'react'
import { api } from '~/trpc/react'

type SubpartWithChildPart = Subpart & {
  childPart: Part
}
export function PartDetail({
  part,
  subparts = [],
  parentParts = [],
  vendorParts = [],
}: {
  part: any
  subparts: SubpartWithChildPart[]
  parentParts: any[]
  vendorParts: any[]
}) {
  const router = useRouter()
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [tab, setTab] = useQueryState('tab', { defaultValue: 'details' })
  const deletePart = api.part.delete.useMutation()
  const deleteSubpart = api.subpart.delete.useMutation()
  // Handle part deletion
  const handleDelete = async () => {
    try {
      setIsLoading(true)
      console.log('delete')
      const result = await deletePart.mutateAsync({ id: part.id })
      if (result.error) {
        toastError({ title: 'Error deleting part' })
      } else {
        toastSuccess({ title: 'Part deleted successfully' })
        router.push('/app/parts')
        router.refresh()
      }
    } catch (error) {
      toastError({ title: 'Error deleting part' })
    } finally {
      setIsLoading(false)
      setIsDeleteDialogOpen(false)
    }
  }
  const handleDeleteSubpart = async (subpart: Subpart) => {
    try {
      setIsLoading(true)
      const result = await deleteSubpart.mutateAsync({
        parentPartId: subpart.parentPartId,
        childPartId: subpart.childPartId,
      })
      if (result?.error) {
        toastError({ title: 'Error deleting subpart' })
      } else {
        toastSuccess({ title: 'Subpart removed successfully' })
        router.refresh()
      }
    } catch (error) {
      toastError({ title: 'Error removing subpart' })
    } finally {
      setIsLoading(false)
    }
  }
  // Calculate total cost of subparts
  const calculateTotalCost = () => {
    if (!subparts || subparts.length === 0) return 0
    return subparts.reduce((total, subpart) => {
      // Get the unit cost from the subpart's child part
      const unitCost = subpart.childPart.inventory?.unitCost || 0
      // Multiply by quantity
      return total + unitCost * subpart.quantity
    }, 0)
  }
  const totalSubpartsCost = calculateTotalCost()
  return (
    <div className='space-y-6'>
      {/* Header with actions */}
      <div className='flex flex-col gap-4 md:flex-row md:items-center md:justify-between'>
        <div className='flex items-center gap-2'>
          <Button variant='ghost' size='icon' onClick={() => router.push('/app/parts')}>
            <ArrowLeft />
          </Button>
          <div>
            <h1 className='text-2xl font-bold tracking-tight'>{part.title}</h1>
            <p className='text-muted-foreground'>
              <span className='font-medium'>SKU:</span> {part.sku}
            </p>
          </div>
        </div>
        <div className='flex items-center gap-2'>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='ghost' size='icon'>
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuItem asChild>
                <Link href={`/app/parts/${part.id}/edit`}>
                  <Edit />
                  Edit
                </Link>
              </DropdownMenuItem>

              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setIsDeleteDialogOpen(true)} variant='destructive'>
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Are you sure you want to delete this part?</DialogTitle>
              <DialogDescription>
                This action cannot be undone. This will permanently delete the part and all
                associated inventory data.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant='outline'
                onClick={() => setIsDeleteDialogOpen(false)}
                disabled={isLoading}>
                Cancel
              </Button>
              <Button
                variant='destructive'
                onClick={handleDelete}
                loading={isLoading}
                loadingText='Deleting...'>
                Delete Part
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className='grid w-full grid-cols-4 md:w-auto'>
          <TabsTrigger value='details'>Details</TabsTrigger>
          <TabsTrigger value='subparts'>
            Subparts
            {subparts.length > 0 && (
              <Badge variant='secondary' className='ml-2'>
                {subparts.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value='parents'>
            Parent Parts
            {parentParts.length > 0 && (
              <Badge variant='secondary' className='ml-2'>
                {parentParts.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value='vendors'>
            Vendors
            {vendorParts.length > 0 && (
              <Badge variant='secondary' className='ml-2'>
                {vendorParts.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Part Details Tab */}
        <TabsContent value='details'>
          <div className='grid gap-6 md:grid-cols-2'>
            <Card>
              <CardHeader>
                <CardTitle>Part Information</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className='space-y-4'>
                  <div className='flex flex-col'>
                    <dt className='text-sm font-medium text-muted-foreground'>Title</dt>
                    <dd className='text-base'>{part.title}</dd>
                  </div>

                  <div className='flex flex-col'>
                    <dt className='text-sm font-medium text-muted-foreground'>SKU</dt>
                    <dd className='text-base'>{part.sku}</dd>
                  </div>

                  <div className='flex flex-col'>
                    <dt className='text-sm font-medium text-muted-foreground'>Category</dt>
                    <dd className='text-base'>
                      {part.category ? (
                        <Badge variant='secondary'>
                          <Tag className='mr-1 h-3 w-3' />
                          {part.category}
                        </Badge>
                      ) : (
                        <span className='text-muted-foreground'>—</span>
                      )}
                    </dd>
                  </div>
                  <div className='flex flex-col'>
                    <dt className='text-sm font-medium text-muted-foreground'>Cost</dt>
                    <dd className='text-base'>
                      {part.cost ? (
                        formatCurrency(part.cost)
                      ) : (
                        <span className='text-muted-foreground'>—</span>
                      )}
                    </dd>
                  </div>

                  <div className='flex flex-col'>
                    <dt className='text-sm font-medium text-muted-foreground'>HS Code</dt>
                    <dd className='text-base'>
                      {part.hsCode || <span className='text-muted-foreground'>—</span>}
                    </dd>
                  </div>

                  <div className='flex flex-col'>
                    <dt className='text-sm font-medium text-muted-foreground'>
                      Shopify Product Link
                    </dt>
                    <dd className='text-base'>
                      {part.shopifyProductLinkId ? (
                        <Link
                          href={`https://admin.shopify.com/store/your-store/products/${part.shopifyProductLinkId}`}
                          className='text-blue-600 hover:underline'
                          target='_blank'
                          rel='noopener noreferrer'>
                          View in Shopify
                        </Link>
                      ) : (
                        <span className='text-muted-foreground'>—</span>
                      )}
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className='flex flex-row items-center justify-between'>
                <div>
                  <CardTitle>Inventory</CardTitle>
                  <CardDescription>Current stock information</CardDescription>
                </div>
                {part.inventory ? (
                  <Button asChild variant='outline' size='sm'>
                    <Link href={`/app/parts/${part.id}/inventory/edit`}>
                      <Edit className='mr-2 h-3 w-3' />
                      Update
                    </Link>
                  </Button>
                ) : (
                  <Button asChild variant='outline' size='sm'>
                    <Link href={`/app/parts/${part.id}/inventory/create`}>
                      <PlusCircle className='mr-2 h-3 w-3' />
                      Add
                    </Link>
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                {part.inventory ? (
                  <dl className='space-y-4'>
                    <div className='flex items-end justify-between'>
                      <dt className='text-sm font-medium text-muted-foreground'>
                        Current Quantity
                      </dt>
                      <dd
                        className={`text-2xl font-bold ${part.inventory.quantity <= (part.inventory.reorderPoint || 0) ? 'text-red-500' : ''}`}>
                        {part.inventory.quantity}
                      </dd>
                    </div>

                    <Separator />

                    <div className='flex flex-col'>
                      <dt className='text-sm font-medium text-muted-foreground'>Location</dt>
                      <dd className='text-base'>
                        {part.inventory.location || (
                          <span className='text-muted-foreground'>—</span>
                        )}
                      </dd>
                    </div>

                    <div className='flex flex-col'>
                      <dt className='text-sm font-medium text-muted-foreground'>Reorder Point</dt>
                      <dd className='text-base'>
                        {part.inventory.reorderPoint !== null &&
                        part.inventory.reorderPoint !== undefined ? (
                          part.inventory.reorderPoint
                        ) : (
                          <span className='text-muted-foreground'>—</span>
                        )}
                      </dd>
                    </div>

                    <div className='flex flex-col'>
                      <dt className='text-sm font-medium text-muted-foreground'>
                        Reorder Quantity
                      </dt>
                      <dd className='text-base'>
                        {part.inventory.reorderQty !== null &&
                        part.inventory.reorderQty !== undefined ? (
                          part.inventory.reorderQty
                        ) : (
                          <span className='text-muted-foreground'>—</span>
                        )}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <div className='flex h-32 flex-col items-center justify-center text-center'>
                    <Blocks className='mb-2 h-8 w-8 text-muted-foreground' />
                    <p className='text-muted-foreground'>No inventory information</p>
                    <p className='text-sm text-muted-foreground'>
                      Add inventory details to track stock levels
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className='md:col-span-2'>
              <CardHeader>
                <CardTitle>Description</CardTitle>
              </CardHeader>
              <CardContent>
                {part.description ? (
                  <p className='whitespace-pre-line'>{part.description}</p>
                ) : (
                  <p className='italic text-muted-foreground'>No description provided</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Subparts Tab */}
        <TabsContent value='subparts'>
          <Card>
            <CardHeader className='flex flex-row items-center justify-between'>
              <div>
                <CardTitle>Subparts</CardTitle>
                <CardDescription>Components required for this part</CardDescription>
              </div>
              <Button asChild>
                <Link href={`/app/parts/${part.id}/subparts/add`}>
                  <PlusCircle className='mr-2 h-4 w-4' />
                  Add Subpart
                </Link>
              </Button>
            </CardHeader>
            <CardContent>
              {subparts.length === 0 ? (
                <div className='flex h-32 flex-col items-center justify-center text-center'>
                  <Package className='mb-2 h-8 w-8 text-muted-foreground' />
                  <p className='text-muted-foreground'>No subparts added yet</p>
                  <p className='text-sm text-muted-foreground'>
                    Add components that make up this part
                  </p>
                </div>
              ) : (
                <div className='rounded-md border'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Part</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead className='text-right'>Quantity</TableHead>
                        <TableHead className='text-right'>Cost</TableHead>
                        <TableHead>Notes</TableHead>
                        <TableHead className='text-right'>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {subparts.map((subpart) => (
                        <TableRow key={subpart.id}>
                          <TableCell className='font-medium'>
                            <Link
                              href={`/app/parts/${subpart.childPart.id}`}
                              className='hover:underline'>
                              {subpart.childPart.title}
                            </Link>
                          </TableCell>
                          <TableCell>{subpart.childPart.sku}</TableCell>
                          <TableCell className='text-right font-medium'>
                            {subpart.quantity}
                          </TableCell>
                          <TableCell className='text-right font-medium'>
                            {formatCurrency(subpart.childPart.cost)}
                            {/* {subpart.childPart} */}
                          </TableCell>

                          <TableCell className='max-w-xs truncate'>
                            {subpart.notes || <span className='text-muted-foreground'>—</span>}
                          </TableCell>
                          <TableCell className='text-right'>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant='ghost' className='h-8 w-8 p-0'>
                                  <span className='sr-only'>Open menu</span>
                                  <MoreHorizontal />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align='end'>
                                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem asChild>
                                  <Link href={`/app/parts/${part.id}/subparts/${subpart.id}/edit`}>
                                    <Edit className='mr-2 h-4 w-4' />
                                    Edit
                                  </Link>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className='text-red-600 focus:text-red-600'
                                  onClick={() => handleDeleteSubpart(subpart)}>
                                  <Trash2 className='mr-2 h-4 w-4' />
                                  Remove
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Parent Parts Tab */}
        <TabsContent value='parents'>
          <Card>
            <CardHeader>
              <CardTitle>Parent Parts</CardTitle>
              <CardDescription>Assemblies this part is used in</CardDescription>
            </CardHeader>
            <CardContent>
              {parentParts.length === 0 ? (
                <div className='flex h-32 flex-col items-center justify-center text-center'>
                  <Package className='mb-2 h-8 w-8 text-muted-foreground' />
                  <p className='text-muted-foreground'>Not used in any assemblies</p>
                  <p className='text-sm text-muted-foreground'>
                    This part is not a component of any other parts
                  </p>
                </div>
              ) : (
                <div className='rounded-md border'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Assembly</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead className='text-right'>Quantity Used</TableHead>
                        <TableHead>Notes</TableHead>
                        <TableHead className='text-right'>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {parentParts.map((parentPart) => (
                        <TableRow key={parentPart.id}>
                          <TableCell className='font-medium'>
                            <Link
                              href={`/app/parts/${parentPart.parentPart.id}`}
                              className='hover:underline'>
                              {parentPart.parentPart.title}
                            </Link>
                          </TableCell>
                          <TableCell>{parentPart.parentPart.sku}</TableCell>
                          <TableCell className='text-right font-medium'>
                            {parentPart.quantity}
                          </TableCell>
                          <TableCell className='max-w-xs truncate'>
                            {parentPart.notes || <span className='text-muted-foreground'>—</span>}
                          </TableCell>
                          <TableCell className='text-right'>
                            <Button asChild variant='ghost' size='sm'>
                              <Link href={`/app/parts/${parentPart.parentPart.id}`}>View</Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Vendors Tab */}
        <TabsContent value='vendors'>
          <Card>
            <CardHeader className='flex flex-row items-center justify-between'>
              <div>
                <CardTitle>Vendors</CardTitle>
                <CardDescription>Suppliers for this part</CardDescription>
              </div>
              <Button asChild>
                <Link href={`/app/parts/${part.id}/vendors/add`}>
                  <PlusCircle className='mr-2 h-4 w-4' />
                  Add Vendor
                </Link>
              </Button>
            </CardHeader>
            <CardContent>
              {vendorParts.length === 0 ? (
                <div className='flex h-32 flex-col items-center justify-center text-center'>
                  <Store className='mb-2 h-8 w-8 text-muted-foreground' />
                  <p className='text-muted-foreground'>No vendors added yet</p>
                  <p className='text-sm text-muted-foreground'>Add suppliers for this part</p>
                </div>
              ) : (
                <div className='rounded-md border'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Vendor</TableHead>
                        <TableHead>Vendor SKU</TableHead>
                        <TableHead className='text-right'>Unit Price</TableHead>
                        <TableHead className='text-right'>Lead Time</TableHead>
                        <TableHead className='text-right'>Min Order</TableHead>
                        <TableHead className='text-right'>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {vendorParts.map((vendorPart) => (
                        <TableRow key={vendorPart.id}>
                          <TableCell className='font-medium'>
                            <div className='flex items-center'>
                              <Link
                                href={`/app/manufacturing/vendors/${vendorPart.vendor.id}`}
                                className='hover:underline'>
                                {vendorPart.vendor.name}
                              </Link>
                              {vendorPart.isPreferred && (
                                <Badge className='ml-2 bg-green-100 text-green-800 hover:bg-green-100'>
                                  Preferred
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>{vendorPart.vendorSku}</TableCell>
                          <TableCell className='text-right'>
                            {vendorPart.unitPrice ? (
                              formatCurrency(vendorPart.unitPrice)
                            ) : (
                              <span className='text-muted-foreground'>—</span>
                            )}
                          </TableCell>
                          <TableCell className='text-right'>
                            {vendorPart.leadTime ? (
                              `${vendorPart.leadTime} ${pluralize(vendorPart.leadTime, 'day')}`
                            ) : (
                              <span className='text-muted-foreground'>—</span>
                            )}
                          </TableCell>
                          <TableCell className='text-right'>
                            {vendorPart.minOrderQty || (
                              <span className='text-muted-foreground'>—</span>
                            )}
                          </TableCell>
                          <TableCell className='text-right'>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant='ghost' className='h-8 w-8 p-0'>
                                  <span className='sr-only'>Open menu</span>
                                  <MoreHorizontal />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align='end'>
                                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem asChild>
                                  <Link
                                    href={`/app/parts/${part.id}/vendors/${vendorPart.vendor.id}/edit`}>
                                    <Edit className='mr-2 h-4 w-4' />
                                    Edit
                                  </Link>
                                </DropdownMenuItem>
                                {!vendorPart.isPreferred && (
                                  <DropdownMenuItem>
                                    <Truck className='mr-2 h-4 w-4' />
                                    Make Preferred
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem className='text-red-600 focus:text-red-600'>
                                  <Trash2 className='mr-2 h-4 w-4' />
                                  Remove
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
