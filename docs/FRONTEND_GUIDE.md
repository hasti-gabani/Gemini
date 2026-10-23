# Frontend guide (Tallin Sales)

React 19 + Vite 8 + React Router 7 (`react-router` package, data router) + TanStack Query 5 + Tailwind CSS 4.
Everything talks to the Django API under `/api/` on the **same origin** (session cookie + CSRF). In development Vite
(port 3000) proxies `/api` to Django (port 8000).

```
frontend/src/
  main.jsx, App.jsx            providers + routes (lazy pages)
  index.css                    design tokens, .field/.card/.num classes, print rules
  lib/api.js                   api.get/post/put/patch/del, ApiError, fieldError(), apiUrl()
  lib/money.js                 BigInt money helpers: formatMoney, formatQty, formatCompact, sanitizeNumberInput, amountInWords, compareMoney, addMoney, subMoney …
  lib/billCalc.js              calcLine / calcBill (exact mirror of backend calc.py)
  lib/dates.js                 todayISO, formatDate (dd/mm/yyyy), formatDateMedium (16 Sep 2026), addDays, relativeDay, PERIOD_OPTIONS
  lib/hooks.js                 useDebounced, useMediaQuery/useIsDesktop, usePagedList, useInvalidateAll, useOnVisible, useLocalStorage, useBeforeUnload
  lib/share.js                 downloadFile, openInNewTab, shareFile (Web Share with PDF), shareText, copyText, openExternal, telLink
  lib/i18n.js                  English/Gujarati dictionary (t(key) via useSession)
  lib/routes.js                NAV_ITEMS, QUICK_ACTIONS, recordPath(type, id)
  context/SessionContext.jsx   useSession(): { user, business, settings, t, language, theme, setSession, patchSession, logout }
  context/UIContext.jsx        useUI(): { toast.success/error/info, confirm({...}) → Promise<boolean> }
  components/layout/Page.jsx   <Page> screen wrapper + <Fab>
  components/ui/*              Button, Modal, form controls, misc display components
  components/RemindDialog.jsx  payment reminder dialog (WhatsApp/SMS/share)
  pages/…                      one folder per module
```

## Rules

1. **Never use floats for money.** API amounts are strings (`"12500.00"`). Display with `formatMoney(value)` →
   `₹12,500.00` (Indian grouping). `formatMoney(v, { decimals: 'auto' })` hides `.00`. Compare/add with
   `compareMoney`, `addMoney`, `subMoney`, `isPositive`, `isNegative`. Inputs use `<NumberInput>` (keeps a string).
2. **Dates** are ISO strings `YYYY-MM-DD` from/to the API. Show with `formatDate` (dd/mm/yyyy) or `formatDateMedium`.
   Use native `<DateInput>` (mobile date pickers).
3. **After any create/update/delete** call `invalidate()` from `useInvalidateAll()` — balances, stock, dashboard and
   reports all depend on each other. Then `toast.success('…')`.
4. **Errors:** `ApiError` has `.message` (friendly) and `.errors` (flat map, dotted paths e.g. `items.0.quantity`).
   Show field errors under fields (`fieldError(errors, 'name')`) and `toast.error(error)` for the rest.
5. **Destructive actions** always go through `const ok = await confirm({ title, message, confirmText: 'Delete', tone: 'danger' })`.
   Use `typeToConfirm: 'DELETE'` for irreversible bulk deletes.
6. **Responsive, mobile-first.** No horizontal page scroll at 320px. Phones/tablets (<1024px): lists are card rows
   (`card` + `divide-y`), tables only inside `overflow-x-auto`. Desktop (`lg:` ≥1024px): real `<table>`s.
   Touch targets ≥ 44px. Inputs are 16px (already in `.field`).
7. **Text never uses colour alone** for meaning: pair green/red amounts with a label ("You'll Get", "Payable",
   status badge).
8. **Empty states** with an icon, a message and the primary action (`<EmptyState icon title message action />`).
9. **Loading:** `<ListSkeleton />` / `<Skeleton />` on first load; keep previous data while refetching
   (`placeholderData: keepPreviousData` or `usePagedList`, which already does it).
10. Use existing i18n keys through `const { t } = useSession()` where one fits (see `lib/i18n.js`); otherwise plain
    English strings. Important headline labels can show the Gujarati form via `gujarati(key)`.
11. Do not add npm dependencies.

## Design tokens (Tailwind colour names)

| Token | Use |
|---|---|
| `bg-canvas` | app background |
| `bg-card`, `.card` | surfaces (`.card` = white, 1px `border-line`, rounded-2xl, soft shadow) |
| `bg-muted`, `bg-subtle` | hover rows, table headers, chips |
| `border-line`, `border-line-strong` | hairlines / input borders |
| `text-ink`, `text-ink-2`, `text-ink-3` | primary / secondary / muted text |
| `bg-brand`, `text-brand-ink`, `bg-brand-soft` | primary actions, links, active states |
| `text-pos`, `bg-pos-soft` | received / receivable / paid / positive |
| `text-neg`, `bg-neg-soft` | payable / pending / overdue / danger |
| `text-warn`, `bg-warn-soft` | partial / low stock |
| `.num` | tabular numbers in table columns |
| `.field` | every input/select/textarea (use the form components) |

Typical card list row: `flex items-center gap-3 px-4 py-3 transition hover:bg-muted`.
Section headings: `text-base font-semibold text-ink`. Page grid gaps: `gap-3 lg:gap-4`.

## Components

### `<Page>` (`components/layout/Page.jsx`)
```jsx
<Page
  title="Items"                         // mobile app-bar title + desktop h1
  subtitle="120 items"                  // optional
  back="/items"                         // string path, or true for history back; omit on top-level screens
  actions={<Button icon={Plus} to="/items/new">Add Item</Button>}   // desktop header (and mobile unless mobileActions given)
  mobileActions={<IconMenu … />}        // compact icon buttons for the phone app bar (null to hide)
  headerExtra={<Tabs … />}              // rendered under the mobile app bar and above content on desktop
  footer={<><Button variant="secondary">Save &amp; New</Button><Button>Save</Button></>}  // sticky action bar (forms)
  fab={<Fab><Button icon={Plus} to="/items/new" size="lg">Add Item</Button></Fab>}          // phones only
  maxWidth="max-w-7xl"                  // content width (forms usually max-w-3xl)
>
```
Routes that render a sticky `footer` must have `handle: { hideNav: true }` (already set for `/new`, `/:id`, `/:id/edit` of
bills & payments, and `/new`, `/:id/edit` of parties & items).

### Buttons & feedback
- `<Button variant="primary|secondary|ghost|soft|danger|danger-soft|success|success-soft" size="sm|md|lg|icon|icon-sm" icon={Icon} loading to="/path" onClick>`.
- `<Modal open onClose title subtitle size="sm|md|lg|xl|full" footer headerRight fullHeight>` — bottom sheet on
  phones, dialog on desktop, Escape/backdrop close.
- `useUI().toast.success(msg)`, `toast.error(errorOrMsg)`; `await confirm({ title, message, details, confirmText, tone, typeToConfirm })`.

### Form controls (`components/ui/form.jsx`)
`<Field label hint error required htmlFor labelRight>`, `<TextInput error …>`, `<TextArea rows …>`,
`<Select options={[{value,label}]} placeholder …>`, `<DateInput …>`,
`<NumberInput value onChange(str) decimals={2|3} allowNegative prefix="₹" suffix="%" align="right">`,
`<Checkbox checked onChange(bool) label description>`, `<Switch checked onChange label description>`,
`<Segmented value onChange options={[{value,label,tone}]} size>`, `<FormSection title description actions>`.

### Display (`components/ui/misc.jsx`)
`Spinner, PageLoader, Skeleton, ListSkeleton, ErrorState({error,onRetry}), EmptyState({icon,title,message,action}),
Badge({tone:'neutral|brand|pos|neg|warn'}), StatusBadge({status:'paid|partial|unpaid', overdue}),
Amount({value, tone:'none|auto|pos|neg|muted', absolute}), Tabs({items:[{value,label,count,icon}], value, onChange}),
Chips({items, value, onChange}), SearchInput({value,onChange,placeholder}), Menu({trigger:({toggle})=>…, items:[{label,icon,onClick,to,danger,hidden,divider}]}),
LoadMore({list}) (infinite scroll footer for usePagedList), SectionHeader, LinkRow({to|onClick}), KeyValue({label}), Avatar({name})`.

### Data hooks
```js
const list = usePagedList(['items'], '/items/', { search: debouncedSearch, category }, { pageSize: 30 })
// list.rows, list.count, list.summary, list.isPending, list.isError, list.error, list.refetch, <LoadMore list={list} />

const query = useQuery({ queryKey: ['item', id], queryFn: () => api.get(`/items/${id}/`) })
const invalidate = useInvalidateAll()
const save = useMutation({ mutationFn: (body) => api.post('/items/', body), onSuccess: () => { invalidate(); … } })
```
Search inputs: keep raw text in state and pass `useDebounced(text, 300)` to the query.

### Downloads / sharing
`downloadFile('/reports/sales/xlsx/', params)`; `openInNewTab('/reports/sales/pdf/', params)` for viewing/printing a
PDF; `shareFile('/…/pdf/', params, { title, text })` opens the phone share sheet with the PDF (falls back to
download). Record links: `recordPath('sale', 12)` → `/sales/12`.

## API conventions

- Paginated lists: `{ count, page, page_size, num_pages, next, previous, results: [...], summary? }`
  (`page`, `page_size` ≤ 200 query params).
- Period filters everywhere: `period=today|yesterday|this_week|last_week|this_month|last_month|this_quarter|this_fy|last_fy|last_7_days|last_30_days|all|custom`
  with `date_from` / `date_to` (YYYY-MM-DD) for `custom`.
- Errors: `{ detail, errors: { field: message } }`.

The backend source is the source of truth for shapes: `backend/*/serializers.py`, `backend/*/views.py`,
`backend/*/urls.py`, `backend/config/urls.py`.
