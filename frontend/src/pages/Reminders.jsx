import { useMutation, useQuery } from '@tanstack/react-query'
import { BellPlus, BellRing, CircleCheckBig, MessageCircle, Plus, SearchX } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'

import Page, { Fab } from '../components/layout/Page.jsx'
import RemindDialog from '../components/RemindDialog.jsx'
import Button from '../components/ui/Button.jsx'
import { Checkbox } from '../components/ui/form.jsx'
import { Chips, EmptyState, ErrorState, ListSkeleton, LoadMore, SearchInput, Spinner, Tabs } from '../components/ui/misc.jsx'
import { useSession } from '../context/SessionContext.jsx'
import { useUI } from '../context/UIContext.jsx'
import { api } from '../lib/api.js'
import { addDays, todayISO } from '../lib/dates.js'
import { useDebounced, useInvalidateAll, usePagedList } from '../lib/hooks.js'
import { addMoney, formatMoney } from '../lib/money.js'
import PartyPickerModal from './reports/PartyPicker.jsx'
import BulkRemindDialog from './reminders/BulkRemindDialog.jsx'
import ReminderRow from './reminders/ReminderRow.jsx'
import { DUE_FILTERS } from './reminders/reminderUtils.js'
import Suggestions from './reminders/Suggestions.jsx'

const NONE = new Set()

function useReminderCount(status) {
  return useQuery({
    queryKey: ['reminders', 'count', status],
    queryFn: ({ signal }) => api.get('/reminders/', { status, page_size: 1 }, { signal }),
    select: (data) => data?.count ?? 0,
  })
}

export default function Reminders() {
  const { t, settings } = useSession()
  const { toast, confirm } = useUI()
  const invalidate = useInvalidateAll()
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounced(search.trim(), 300)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [dialog, setDialog] = useState(null)

  const tab = searchParams.get('tab') === 'done' ? 'done' : 'pending'
  const due = DUE_FILTERS.some((filter) => filter.value === searchParams.get('due')) ? searchParams.get('due') : 'all'

  const setParam = useCallback((name, value, fallback) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (!value || value === fallback) next.delete(name)
      else next.set(name, value)
      return next
    }, { replace: true })
  }, [setSearchParams])

  // "+ Reminder" quick action links to /reminders?new=1
  useEffect(() => {
    if (searchParams.get('new') !== '1') return
    setPickerOpen(true)
    setParam('new', null)
  }, [searchParams, setParam])

  const pendingCount = useReminderCount('pending')
  const doneCount = useReminderCount('done')

  const list = usePagedList(['reminders', 'list'], '/reminders/', {
    status: tab,
    due: tab === 'pending' && due !== 'all' ? due : undefined,
    search: debouncedSearch || undefined,
  }, { pageSize: 30 })

  // Ticked pending reminders, to remind those parties together. Ticks belong to the list they were made
  // in: another tab, filter or search starts with none.
  const listKey = `${tab}|${due}|${debouncedSearch}`
  const [selection, setSelection] = useState({ key: listKey, ids: NONE })
  const [selectingAll, setSelectingAll] = useState(false)
  const [bulk, setBulk] = useState(null) // the reminders shown in the "remind together" dialog
  if (selection.key !== listKey) setSelection({ key: listKey, ids: NONE })
  const selectedIds = selection.key === listKey ? selection.ids : NONE
  const selected = list.rows.filter((row) => selectedIds.has(row.id))
  const allSelected = selected.length > 0 && selected.length === list.count
  const select = (ids) => setSelection({ key: listKey, ids })

  const toggle = (id, checked) => {
    const next = new Set(selectedIds)
    if (checked) next.add(id)
    else next.delete(id)
    select(next)
  }

  const toggleAll = async (checked) => {
    if (!checked) {
      select(NONE)
      return
    }
    // "All" means every reminder in this list, so first load the pages not shown yet.
    setSelectingAll(true)
    try {
      let result = list
      for (let step = 0; result.hasNextPage && step < 50; step += 1) {
        result = await list.fetchNextPage()
        if (result.isError) throw result.error
      }
      select(new Set((result.data?.pages || []).flatMap((page) => page?.results || []).map((row) => row.id)))
    } catch (error) {
      toast.error(error)
    } finally {
      setSelectingAll(false)
    }
  }

  // Parties from the suggestions list below: set a reminder for each, then send them together.
  const [settingMany, setSettingMany] = useState(false)
  const remindMany = async (parties) => {
    setSettingMany(true)
    try {
      const dueDate = addDays(todayISO(), settings?.reminder_lead_days ?? 3)
      const created = []
      for (const party of parties) {
        created.push(await api.post('/reminders/', { party: party.party, amount: party.amount || '0', due_date: dueDate }))
      }
      invalidate()
      setBulk(created)
    } catch (error) {
      toast.error(error)
    } finally {
      setSettingMany(false)
    }
  }

  const action = useMutation({
    mutationFn: ({ type, reminder }) => (type === 'delete'
      ? api.del(`/reminders/${reminder.id}/`)
      : api.post(`/reminders/${reminder.id}/${type}/`)),
    onSuccess: (_data, { type, reminder, undo }) => {
      invalidate()
      if (type === 'complete') {
        toast.success(`Marked done: ${reminder.party_name}`, {
          action: { label: 'Undo', onClick: () => action.mutate({ type: 'reopen', reminder, undo: true }) },
        })
      } else if (type === 'reopen') {
        toast.success(undo ? 'Reminder restored.' : `Moved back to pending: ${reminder.party_name}`)
      } else {
        toast.success('Reminder deleted.')
      }
    },
    onError: (error) => toast.error(error),
  })
  const busyId = action.isPending ? action.variables?.reminder.id : null

  const remove = async (reminder) => {
    const ok = await confirm({
      title: 'Delete reminder?',
      message: `The reminder for ${reminder.party_name} (${formatMoney(reminder.amount)}) will be deleted. This does not change the party's balance.`,
      confirmText: 'Delete',
      tone: 'danger',
    })
    if (ok) action.mutate({ type: 'delete', reminder })
  }

  const openPicker = () => setPickerOpen(true)
  const filtered = Boolean(debouncedSearch) || (tab === 'pending' && due !== 'all')
  const clearFilters = () => {
    setSearch('')
    setParam('due', null)
  }

  let empty
  if (filtered) {
    empty = (
      <EmptyState
        icon={SearchX}
        title="No reminders found"
        message={debouncedSearch ? `No ${tab === 'done' ? 'completed' : 'pending'} reminders match “${debouncedSearch}”.` : 'No pending reminders match this filter.'}
        action={<Button variant="secondary" onClick={clearFilters}>Clear filters</Button>}
      />
    )
  } else if (tab === 'pending') {
    empty = (
      <EmptyState
        icon={BellRing}
        title="No pending reminders"
        message="Set a reminder for parties who owe you money. It stays here until you mark it done."
        action={<Button icon={BellPlus} onClick={openPicker}>New Reminder</Button>}
      />
    )
  } else {
    empty = (
      <EmptyState
        icon={CircleCheckBig}
        title="No completed reminders"
        message="Reminders you mark as done appear here."
      />
    )
  }

  return (
    <Page
      title={t('reminders')}
      subtitle={pendingCount.data !== undefined ? `${pendingCount.data} pending` : undefined}
      actions={<Button icon={BellPlus} onClick={openPicker}>New Reminder</Button>}
      mobileActions={null}
      headerExtra={(
        <Tabs
          items={[
            { value: 'pending', label: t('pending'), count: pendingCount.data },
            { value: 'done', label: 'Done', count: doneCount.data },
          ]}
          value={tab}
          onChange={(value) => setParam('tab', value, 'pending')}
        />
      )}
      fab={selected.length > 0 ? (
        <Fab><Button icon={MessageCircle} size="lg" onClick={() => setBulk(selected)}>{t('remind')} ({selected.length})</Button></Fab>
      ) : (
        <Fab><Button icon={Plus} size="lg" onClick={openPicker}>New Reminder</Button></Fab>
      )}
      maxWidth="max-w-5xl"
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {tab === 'pending' ? (
            <div className="-mx-4 sm:mx-0" role="group" aria-label="Due date filter">
              <Chips items={DUE_FILTERS} value={due} onChange={(value) => setParam('due', value, 'all')} className="px-4 sm:px-0" />
            </div>
          ) : <span className="hidden lg:block" />}
          <SearchInput value={search} onChange={setSearch} placeholder="Search party name or mobile" className="lg:w-80" />
        </div>

        <section className="card" aria-label={tab === 'pending' ? 'Pending reminders' : 'Completed reminders'}>
          {tab === 'pending' && list.rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2 sm:px-5">
              <Checkbox checked={allSelected} onChange={toggleAll} disabled={selectingAll} label={t('select_all')} className="min-h-11 items-center" />
              {selectingAll && <Spinner className="size-4" />}
              {selected.length > 0 && (
                <>
                  <p className="text-sm text-ink-2">
                    {t('selected_count', { count: selected.length })}
                    {' · '}
                    <span className="num font-semibold text-ink">{formatMoney(addMoney(...selected.map((row) => row.amount)))}</span>
                  </p>
                  <div className="ml-auto flex items-center gap-2">
                    <Button variant="ghost" onClick={() => select(NONE)}>Clear</Button>
                    <Button icon={MessageCircle} onClick={() => setBulk(selected)}>{t('remind')} ({selected.length})</Button>
                  </div>
                </>
              )}
            </div>
          )}
          {list.isError ? (
            <ErrorState error={list.error} onRetry={list.refetch} />
          ) : list.isPending ? (
            <ListSkeleton rows={4} />
          ) : list.rows.length === 0 ? (
            empty
          ) : (
            <ul className={`divide-y divide-line transition-opacity ${list.isPlaceholderData ? 'opacity-60' : ''}`}>
              {list.rows.map((reminder) => (
                <ReminderRow
                  key={reminder.id}
                  reminder={reminder}
                  busyAction={busyId === reminder.id ? action.variables.type : null}
                  selected={selectedIds.has(reminder.id)}
                  onSelect={tab === 'pending' ? (checked) => toggle(reminder.id, checked) : undefined}
                  onRemind={() => setDialog({ reminder: { ...reminder, message: '' } })}
                  onEdit={() => setDialog({ reminder })}
                  onComplete={() => action.mutate({ type: 'complete', reminder })}
                  onReopen={() => action.mutate({ type: 'reopen', reminder })}
                  onDelete={() => remove(reminder)}
                />
              ))}
            </ul>
          )}
          <LoadMore list={list} />
        </section>

        {tab === 'pending' && (
          <Suggestions
            search={debouncedSearch}
            onSetReminder={(party) => setDialog({ party })}
            onRemindMany={remindMany}
            busy={settingMany}
          />
        )}
      </div>

      <PartyPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="New reminder · choose party"
        params={{ filter: 'receivable' }}
        searchPlaceholder="Search party name or mobile"
        emptyMessage="No parties have pending payments right now."
        onSelect={(party) => {
          if (party) setDialog({ party: { id: party.id, name: party.name, phone: party.phone, balance: party.balance } })
        }}
      />
      <RemindDialog open={Boolean(dialog)} onClose={() => setDialog(null)} party={dialog?.party} reminder={dialog?.reminder} />
      <BulkRemindDialog open={Boolean(bulk)} onClose={() => setBulk(null)} reminders={bulk || []} />
    </Page>
  )
}
