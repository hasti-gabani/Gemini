import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ImagePlus, RotateCcw, Trash2, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useBlocker, useNavigate, useParams } from 'react-router'

import Page from '../../components/layout/Page.jsx'
import Button from '../../components/ui/Button.jsx'
import { Field, FormSection, NumberInput, Select, Switch, TextArea, TextInput } from '../../components/ui/form.jsx'
import { ErrorState, FitAmount, PageLoader } from '../../components/ui/misc.jsx'
import { useSession } from '../../context/SessionContext.jsx'
import { useUI } from '../../context/UIContext.jsx'
import { api, fieldError } from '../../lib/api.js'
import { useBeforeUnload, useInvalidateAll } from '../../lib/hooks.js'
import { formatQty, fromScaled, isValidNumber, toScaled } from '../../lib/money.js'
import { CATEGORIES_KEY, IconButton, moneyInput, qtyInput, useCategories } from './shared.jsx'

const MAX_IMAGE_MB = 8
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp']
const NEW_CATEGORY = '__new__'
const TOO_LARGE = 10n ** 14n // 14 digits in total, like the server's DecimalFields
const NO_IMAGE = { file: null, preview: null, removed: false }

function emptyForm(settings) {
  const units = (settings?.units || []).map((unit) => String(unit).toUpperCase())
  return {
    name: '',
    code: '',
    category: '',
    unit: units.includes('PCS') ? 'PCS' : units[0] || 'PCS',
    hsn: '',
    sale_price: '',
    purchase_price: '',
    track_stock: true,
    opening_stock: '',
    low_stock_limit: '',
    description: '',
    is_active: true,
  }
}

function formFromItem(item) {
  return {
    name: item.name || '',
    code: item.code || '',
    category: item.category ? String(item.category) : '',
    unit: item.unit || 'PCS',
    hsn: item.hsn || '',
    sale_price: moneyInput(item.sale_price),
    purchase_price: moneyInput(item.purchase_price),
    track_stock: Boolean(item.track_stock),
    opening_stock: qtyInput(item.opening_stock),
    low_stock_limit: qtyInput(item.low_stock_limit),
    description: item.description || '',
    is_active: Boolean(item.is_active),
  }
}

function validate(form) {
  const errors = {}
  if (!form.name.trim()) errors.name = 'Item name is required.'
  const numbers = [
    ['sale_price', 2, 'amount'],
    ['purchase_price', 2, 'amount'],
    ...(form.track_stock ? [['opening_stock', 3, 'quantity'], ['low_stock_limit', 3, 'quantity']] : []),
  ]
  for (const [key, places, noun] of numbers) {
    const value = form[key]
    if (value === '') continue
    if (!isValidNumber(value)) errors[key] = `Enter a valid ${noun}.`
    else if (toScaled(value, places) >= TOO_LARGE) errors[key] = noun === 'amount' ? 'Amount is too large.' : 'Quantity is too large.'
  }
  return errors
}

/** JSON normally; multipart only when a photo is added or removed.
 * GST is not used on bills, so the item's saved tax fields are never sent (and never changed). */
function buildBody(form, image, editing) {
  const money = (value) => (isValidNumber(value) ? fromScaled(toScaled(value, 2), 2) : '0.00')
  const qty = (value) => (isValidNumber(value) ? fromScaled(toScaled(value, 3), 3) : '0.000')
  const data = {
    name: form.name.trim(),
    code: form.code.trim(),
    category: form.category ? Number(form.category) : null,
    unit: form.unit || 'PCS',
    hsn: form.hsn.trim(),
    sale_price: money(form.sale_price),
    purchase_price: money(form.purchase_price),
    track_stock: form.track_stock,
    opening_stock: qty(form.opening_stock),
    low_stock_limit: qty(form.low_stock_limit),
    description: form.description.trim(),
  }
  if (editing) data.is_active = form.is_active
  if (!image.file && !image.removed) return data
  const body = new FormData()
  for (const [key, value] of Object.entries(data)) {
    if (value === null) body.append(key, '')
    else if (typeof value === 'boolean') body.append(key, value ? 'true' : 'false')
    else body.append(key, String(value))
  }
  if (image.file) body.append('image', image.file)
  else body.append('remove_image', 'true')
  return body
}

function ReadOnlyStat({ label, value, tone = 'text-ink' }) {
  return (
    <div className="min-w-0 rounded-xl bg-muted px-3 py-2.5">
      <dt className="break-words text-xs text-ink-3">{label}</dt>
      <FitAmount as="dd" className={`mt-0.5 text-[15px] font-semibold ${tone}`}>{value}</FitAmount>
    </div>
  )
}

function ItemFormBody({ item }) {
  const editing = Boolean(item)
  const { t, settings } = useSession()
  const { toast, confirm } = useUI()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const invalidate = useInvalidateAll()
  const uid = useId()
  const formId = `${uid}form`
  const fileRef = useRef(null)
  const nameRef = useRef(null)
  const categories = useCategories()

  const [initial] = useState(() => (item ? formFromItem(item) : emptyForm(settings)))
  const [form, setForm] = useState(initial)
  const [errors, setErrors] = useState({})
  const [image, setImage] = useState(NO_IMAGE)
  const [imageError, setImageError] = useState('')
  const [newCategory, setNewCategory] = useState(null) // { name, error }
  const [pending, setPending] = useState('') // 'save' | 'new'

  useEffect(() => () => {
    if (image.preview) URL.revokeObjectURL(image.preview)
  }, [image.preview])

  const dirty = Boolean(image.file) || image.removed || JSON.stringify(form) !== JSON.stringify(initial)
  useBeforeUnload(dirty && !pending)

  // Ask before leaving with unsaved changes (back button, sidebar, ...); saving navigates freely.
  const leaving = useRef(false)
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !leaving.current && currentLocation.pathname !== nextLocation.pathname)
  const asking = useRef(false)
  useEffect(() => {
    if (blocker.state !== 'blocked' || asking.current) return
    asking.current = true
    confirm({ title: 'Discard changes?', message: 'Your changes to this item are not saved.', confirmText: 'Discard', cancelText: 'Keep editing', tone: 'danger' })
      .then((ok) => {
        asking.current = false
        if (ok) blocker.proceed()
        else blocker.reset()
      })
  }, [blocker, confirm])

  const setField = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }))
    setErrors((current) => (current[key] ? { ...current, [key]: '' } : current))
  }

  const save = useMutation({
    mutationFn: (body) => (editing ? api.patch(`/items/${item.id}/`, body) : api.post('/items/', body)),
  })

  const createCategory = useMutation({
    mutationFn: (name) => api.post('/categories/', { name }),
    onSuccess: (category) => {
      queryClient.setQueryData(CATEGORIES_KEY, (old) => (Array.isArray(old)
        ? [...old, { ...category, item_count: 0 }].sort((a, b) => a.name.localeCompare(b.name))
        : old))
      invalidate()
      setField('category', String(category.id))
      setNewCategory(null)
      toast.success(`Category "${category.name}" added.`)
    },
    onError: (error) => setNewCategory((current) => current && { ...current, error: fieldError(error.errors, 'name') || error.message }),
  })

  const unitOptions = useMemo(() => {
    const units = (settings?.units || []).map((unit) => String(unit).toUpperCase())
    if (form.unit && !units.includes(form.unit)) units.unshift(form.unit)
    if (!units.length) units.push('PCS')
    return units.map((unit) => ({ value: unit, label: unit }))
  }, [settings?.units, form.unit])

  const categoryList = categories.data || []
  const categoryOptions = [
    ...categoryList.map((category) => ({ value: String(category.id), label: category.name })),
    ...(form.category && !categoryList.some((category) => String(category.id) === form.category)
      ? [{ value: form.category, label: (item?.category === Number(form.category) && item.category_name) || 'Selected category' }]
      : []),
    { value: NEW_CATEGORY, label: '+ New category…' },
  ]

  const imageUrl = image.preview || (image.removed ? null : item?.image_url) || null

  const pickImage = (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const extension = (file.name.split('.').pop() || '').toLowerCase()
    if (!(IMAGE_TYPES.includes(file.type) || (!file.type && IMAGE_EXTENSIONS.includes(extension)))) {
      setImageError('Please choose a JPG, PNG or WEBP image.')
      return
    }
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      setImageError(`This photo is ${(file.size / (1024 * 1024)).toFixed(1)} MB. Please choose one smaller than ${MAX_IMAGE_MB} MB.`)
      return
    }
    setImageError('')
    setErrors((current) => (current.image ? { ...current, image: '' } : current))
    setImage({ file, preview: URL.createObjectURL(file), removed: false })
  }

  const removeImage = () => {
    setImage({ file: null, preview: null, removed: Boolean(item?.image_url) })
    setImageError('')
  }

  const addCategory = () => {
    const name = (newCategory?.name || '').trim()
    if (!name) {
      setNewCategory({ ...newCategory, error: 'Enter a category name.' })
      return
    }
    createCategory.mutate(name)
  }

  const focusFirstError = () => {
    requestAnimationFrame(() => {
      const target = document.getElementById(formId)?.querySelector('[aria-invalid="true"]')
      if (!target) return
      target.scrollIntoView({ block: 'center', behavior: 'smooth' })
      target.focus({ preventScroll: true })
    })
  }

  const submit = async (mode) => {
    if (pending) return
    const clientErrors = validate(form)
    setErrors(clientErrors)
    if (Object.keys(clientErrors).length) {
      focusFirstError()
      return
    }
    setPending(mode)
    try {
      const saved = await save.mutateAsync(buildBody(form, image, editing))
      invalidate()
      leaving.current = true
      if (mode === 'new') {
        toast.success(`"${saved.name}" saved. Add the next item.`)
        if (editing) {
          navigate('/items/new', { replace: true })
        } else {
          setForm(initial)
          setImage(NO_IMAGE)
          setImageError('')
          setErrors({})
          setNewCategory(null)
          window.scrollTo({ top: 0, behavior: 'smooth' })
          nameRef.current?.focus({ preventScroll: true })
        }
      } else {
        toast.success(editing ? 'Item updated.' : `"${saved.name}" added.`)
        navigate(`/items/${saved.id}`, { replace: true })
      }
    } catch (error) {
      setErrors(error.errors || {})
      toast.error(error)
      focusFirstError()
    } finally {
      leaving.current = false
      setPending('')
    }
  }

  const err = (key) => fieldError(errors, key)
  const stockTone = editing && item.track_stock && toScaled(item.current_stock, 3) <= 0n ? 'text-neg' : 'text-ink'

  return (
    <Page
      title={editing ? 'Edit Item' : t('add_item')}
      subtitle={editing ? item.name : undefined}
      back={editing ? `/items/${item.id}` : '/items'}
      maxWidth="max-w-3xl"
      footer={(
        <>
          <div className="hidden flex-1 sm:block" />
          <Button
            variant="secondary"
            className="flex-1 sm:flex-none"
            loading={pending === 'new'}
            disabled={Boolean(pending)}
            onClick={() => submit('new')}
          >
            {t('save_new')}
          </Button>
          <Button
            type="submit"
            form={formId}
            className="flex-1 sm:min-w-32 sm:flex-none"
            loading={pending === 'save'}
            disabled={Boolean(pending)}
          >
            {t('save')}
          </Button>
        </>
      )}
    >
      <form
        id={formId}
        noValidate
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          submit('save')
        }}
      >
        <FormSection title="Basic details">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Item Name" required htmlFor={`${uid}name`} error={err('name')} className="sm:col-span-2">
              <TextInput
                ref={nameRef}
                id={`${uid}name`}
                value={form.name}
                maxLength={200}
                autoFocus={!editing}
                autoComplete="off"
                placeholder="e.g. Solar Panel 540W"
                error={err('name')}
                onChange={(event) => setField('name', event.target.value)}
              />
            </Field>

            <Field label="Item Code" htmlFor={`${uid}code`} error={err('code')} hint={err('code') ? undefined : 'SKU or barcode (optional)'}>
              <TextInput
                id={`${uid}code`}
                value={form.code}
                maxLength={50}
                autoComplete="off"
                error={err('code')}
                onChange={(event) => setField('code', event.target.value)}
              />
            </Field>

            <Field
              label="Category"
              htmlFor={`${uid}category`}
              error={err('category')}
              labelRight={!newCategory && (
                <button
                  type="button"
                  className="-my-2 px-1 py-2 text-sm font-medium text-brand-ink hover:underline"
                  onClick={() => setNewCategory({ name: '', error: '' })}
                >
                  + New category
                </button>
              )}
            >
              <Select
                id={`${uid}category`}
                value={form.category}
                placeholder="No category"
                options={categoryOptions}
                error={err('category')}
                onChange={(event) => {
                  if (event.target.value === NEW_CATEGORY) setNewCategory({ name: '', error: '' })
                  else setField('category', event.target.value)
                }}
              />
              {newCategory && (
                <div className="flex items-start gap-2 rounded-xl bg-muted p-2">
                  <div className="min-w-0 flex-1">
                    <TextInput
                      aria-label="New category name"
                      placeholder="New category name"
                      value={newCategory.name}
                      maxLength={80}
                      autoFocus
                      error={newCategory.error}
                      onChange={(event) => setNewCategory({ name: event.target.value, error: '' })}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          addCategory()
                        } else if (event.key === 'Escape') {
                          setNewCategory(null)
                        }
                      }}
                    />
                    {newCategory.error && <p className="mt-1.5 text-sm text-neg" role="alert">{newCategory.error}</p>}
                  </div>
                  <Button onClick={addCategory} loading={createCategory.isPending}>Add</Button>
                  <IconButton icon={X} label="Cancel new category" onClick={() => setNewCategory(null)} />
                </div>
              )}
            </Field>

            <Field label="Unit" htmlFor={`${uid}unit`} error={err('unit')}>
              <Select
                id={`${uid}unit`}
                value={form.unit}
                options={unitOptions}
                error={err('unit')}
                onChange={(event) => setField('unit', event.target.value)}
              />
            </Field>

            <Field label="HSN / SAC Code" htmlFor={`${uid}hsn`} error={err('hsn')}>
              <TextInput
                id={`${uid}hsn`}
                value={form.hsn}
                maxLength={20}
                inputMode="numeric"
                autoComplete="off"
                placeholder="e.g. 8541"
                error={err('hsn')}
                onChange={(event) => setField('hsn', event.target.value)}
              />
            </Field>
          </div>
        </FormSection>

        <FormSection title="Pricing">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Sale Price" htmlFor={`${uid}sale`} error={err('sale_price')}>
              <NumberInput
                id={`${uid}sale`}
                prefix="₹"
                placeholder="0.00"
                value={form.sale_price}
                error={err('sale_price')}
                onChange={(value) => setField('sale_price', value)}
              />
            </Field>
            <Field label="Purchase Price" htmlFor={`${uid}purchase`} error={err('purchase_price')}>
              <NumberInput
                id={`${uid}purchase`}
                prefix="₹"
                placeholder="0.00"
                value={form.purchase_price}
                error={err('purchase_price')}
                onChange={(value) => setField('purchase_price', value)}
              />
            </Field>
          </div>
        </FormSection>

        <FormSection title={t('stock')}>
          <Switch
            checked={form.track_stock}
            onChange={(value) => setField('track_stock', value)}
            label="Track stock"
            description="Turn off for services or items you don't count."
          />
          {form.track_stock && (
            <div className="mt-4 grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
              <Field
                label="Opening Stock"
                htmlFor={`${uid}opening`}
                error={err('opening_stock')}
                hint={editing ? 'Changing it recalculates the current stock.' : 'Quantity you have in hand now.'}
              >
                <NumberInput
                  id={`${uid}opening`}
                  decimals={3}
                  suffix={form.unit}
                  placeholder="0"
                  value={form.opening_stock}
                  error={err('opening_stock')}
                  onChange={(value) => setField('opening_stock', value)}
                />
              </Field>
              <Field
                label="Low Stock Limit"
                htmlFor={`${uid}low`}
                error={err('low_stock_limit')}
                hint="Show a Low Stock alert at or below this quantity."
              >
                <NumberInput
                  id={`${uid}low`}
                  decimals={3}
                  suffix={form.unit}
                  placeholder="0"
                  value={form.low_stock_limit}
                  error={err('low_stock_limit')}
                  onChange={(value) => setField('low_stock_limit', value)}
                />
              </Field>
            </div>
          )}
          {editing && (
            <dl className="mt-4 grid grid-cols-3 gap-2">
              <ReadOnlyStat
                label="Current Stock"
                value={item.track_stock ? `${formatQty(item.current_stock)} ${item.unit}` : '—'}
                tone={stockTone}
              />
              <ReadOnlyStat label="Sold" value={`${formatQty(item.sold_qty)} ${item.unit}`} />
              <ReadOnlyStat label="Purchased" value={`${formatQty(item.purchased_qty)} ${item.unit}`} />
            </dl>
          )}
        </FormSection>

        <FormSection title={t('details')}>
          <div className="space-y-4">
            <Field label={t('description')} htmlFor={`${uid}description`} error={err('description')}>
              <TextArea
                id={`${uid}description`}
                rows={3}
                maxLength={2000}
                placeholder="Brand, size, warranty or other details"
                value={form.description}
                error={err('description')}
                onChange={(event) => setField('description', event.target.value)}
              />
            </Field>

            <Field
              label="Item Image"
              error={imageError || err('image')}
              hint={`JPG, PNG or WEBP · up to ${MAX_IMAGE_MB} MB`}
            >
              <div className="flex items-center gap-4">
                <div className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-2xl border border-dashed border-line-strong bg-muted">
                  {imageUrl ? (
                    <img src={imageUrl} alt="Item preview" className="size-full object-cover" />
                  ) : (
                    <ImagePlus className="size-8 text-ink-3" aria-hidden />
                  )}
                </div>
                <div className="flex min-w-0 flex-wrap gap-2">
                  <Button variant="secondary" icon={ImagePlus} onClick={() => fileRef.current?.click()}>
                    {imageUrl ? 'Change' : 'Add image'}
                  </Button>
                  {imageUrl && <Button variant="danger-soft" icon={Trash2} onClick={removeImage}>Remove</Button>}
                  {image.removed && <Button variant="ghost" icon={RotateCcw} onClick={() => setImage(NO_IMAGE)}>Undo</Button>}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={pickImage}
                />
              </div>
            </Field>

            {editing && (
              <Switch
                className="border-t border-line pt-4"
                checked={form.is_active}
                onChange={(value) => setField('is_active', value)}
                label="Active"
                description="Turn off if you no longer sell this item. Past bills are not affected."
              />
            )}
          </div>
        </FormSection>
      </form>
    </Page>
  )
}

export default function ItemForm() {
  const { id } = useParams()
  const query = useQuery({
    queryKey: ['item', id],
    queryFn: ({ signal }) => api.get(`/items/${id}/`, undefined, { signal }),
    enabled: Boolean(id),
  })

  if (id && !query.data) {
    return (
      <Page title="Edit Item" back={`/items/${id}`} maxWidth="max-w-3xl">
        {query.isError ? (
          <div className="card"><ErrorState error={query.error} onRetry={query.refetch} /></div>
        ) : (
          <PageLoader />
        )}
      </Page>
    )
  }
  return <ItemFormBody key={id || 'new'} item={id ? query.data : null} />
}
