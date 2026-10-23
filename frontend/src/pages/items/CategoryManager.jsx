import { useMutation } from '@tanstack/react-query'
import { Check, Pencil, Plus, Tags, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import Button from '../../components/ui/Button.jsx'
import { TextInput } from '../../components/ui/form.jsx'
import Modal from '../../components/ui/Modal.jsx'
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/misc.jsx'
import { useUI } from '../../context/UIContext.jsx'
import { api, fieldError } from '../../lib/api.js'
import { useInvalidateAll } from '../../lib/hooks.js'
import { IconButton, useCategories } from './shared.jsx'

const itemsLabel = (count) => `${count} item${count === 1 ? '' : 's'}`

/** Add, rename and delete item categories. */
export default function CategoryManager({ open, onClose }) {
  const { toast, confirm } = useUI()
  const invalidate = useInvalidateAll()
  const categories = useCategories({ enabled: open })
  const [name, setName] = useState('')
  const [addError, setAddError] = useState('')
  const [editing, setEditing] = useState(null) // { id, name, error }
  const [deletingId, setDeletingId] = useState(null)

  useEffect(() => {
    if (!open) return
    setName('')
    setAddError('')
    setEditing(null)
  }, [open])

  const add = useMutation({
    mutationFn: (value) => api.post('/categories/', { name: value }),
    onSuccess: (category) => {
      invalidate()
      setName('')
      setAddError('')
      toast.success(`Category "${category.name}" added.`)
    },
    onError: (error) => setAddError(fieldError(error.errors, 'name') || error.message),
  })

  const rename = useMutation({
    mutationFn: ({ id, value }) => api.patch(`/categories/${id}/`, { name: value }),
    onSuccess: (category) => {
      invalidate()
      setEditing(null)
      toast.success(`Category renamed to "${category.name}".`)
    },
    onError: (error) => setEditing((current) => current && { ...current, error: fieldError(error.errors, 'name') || error.message }),
  })

  const submitAdd = (event) => {
    event.preventDefault()
    const value = name.trim()
    if (!value) {
      setAddError('Enter a category name.')
      return
    }
    add.mutate(value)
  }

  const submitRename = (event) => {
    event.preventDefault()
    const value = editing.name.trim()
    if (!value) {
      setEditing({ ...editing, error: 'Enter a category name.' })
      return
    }
    const current = categories.data?.find((category) => category.id === editing.id)
    if (current && current.name === value) {
      setEditing(null)
      return
    }
    rename.mutate({ id: editing.id, value })
  }

  const remove = async (category) => {
    const count = category.item_count || 0
    const ok = await confirm({
      title: 'Delete category?',
      message: count
        ? `"${category.name}" has ${itemsLabel(count)}. The items will not be deleted — they will become Uncategorized.`
        : `"${category.name}" will be deleted.`,
      confirmText: 'Delete',
      tone: 'danger',
    })
    if (!ok) return
    setDeletingId(category.id)
    try {
      await api.del(`/categories/${category.id}/`)
      invalidate()
      toast.success(`Category "${category.name}" deleted.`)
    } catch (error) {
      toast.error(error)
    } finally {
      setDeletingId(null)
    }
  }

  const list = categories.data || []

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Manage categories"
      subtitle="Group items to find them faster"
      size="md"
      footer={(
        <div className="flex justify-end">
          <Button variant="secondary" className="w-full sm:w-auto" onClick={onClose}>Done</Button>
        </div>
      )}
    >
      <form onSubmit={submitAdd} noValidate className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <TextInput
            aria-label="New category name"
            placeholder="New category, e.g. Batteries"
            value={name}
            maxLength={80}
            data-autofocus
            error={addError}
            onChange={(event) => {
              setName(event.target.value)
              if (addError) setAddError('')
            }}
          />
          {addError && <p className="mt-1.5 text-sm text-neg" role="alert">{addError}</p>}
        </div>
        <Button type="submit" icon={Plus} loading={add.isPending}>Add</Button>
      </form>

      <div className="-mx-5 mt-4 border-t border-line">
        {categories.isPending ? (
          <div className="space-y-3 px-5 py-4">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : categories.isError ? (
          <ErrorState error={categories.error} onRetry={categories.refetch} />
        ) : list.length === 0 ? (
          <EmptyState icon={Tags} title="No categories yet" message="Add categories like Batteries or Cables, then pick one when adding an item." />
        ) : (
          <ul className="divide-y divide-line">
            {list.map((category) => (
              <li key={category.id} className="flex min-h-16 items-center gap-1 py-2 pl-5 pr-3">
                {editing?.id === category.id ? (
                  <form onSubmit={submitRename} noValidate className="flex min-w-0 flex-1 items-start gap-1">
                    <div className="min-w-0 flex-1 pr-1">
                      <TextInput
                        aria-label={`New name for ${category.name}`}
                        value={editing.name}
                        maxLength={80}
                        autoFocus
                        error={editing.error}
                        onChange={(event) => setEditing({ ...editing, name: event.target.value, error: '' })}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            event.stopPropagation()
                            setEditing(null)
                          }
                        }}
                      />
                      {editing.error && <p className="mt-1.5 text-sm text-neg" role="alert">{editing.error}</p>}
                    </div>
                    <IconButton type="submit" icon={Check} label="Save name" disabled={rename.isPending} tone="brand" />
                    <IconButton icon={X} label="Cancel rename" onClick={() => setEditing(null)} />
                  </form>
                ) : (
                  <>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-medium text-ink">{category.name}</p>
                      <p className="text-sm text-ink-3">{itemsLabel(category.item_count || 0)}</p>
                    </div>
                    <IconButton
                      icon={Pencil}
                      label={`Rename ${category.name}`}
                      onClick={() => setEditing({ id: category.id, name: category.name, error: '' })}
                    />
                    <IconButton
                      icon={Trash2}
                      label={`Delete ${category.name}`}
                      danger
                      disabled={deletingId === category.id}
                      onClick={() => remove(category)}
                    />
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
