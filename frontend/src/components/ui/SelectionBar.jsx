import { useSession } from '../../context/SessionContext.jsx'
import { Checkbox } from './form.jsx'
import { Spinner } from './misc.jsx'

/**
 * The bar above a list whose rows can be ticked: Select all, how many are ticked, and the
 * buttons that act on them. "All" means the rows on screen, so what is ticked is always visible.
 */
export default function SelectionBar({ allChecked, onToggleAll, count, busy = false, actions, className = '' }) {
  const { t } = useSession()
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2 sm:px-5 ${className}`}>
      <Checkbox checked={allChecked} onChange={onToggleAll} disabled={busy} label={t('select_all')} className="min-h-11 items-center" />
      {busy && <Spinner className="size-4" />}
      {count > 0 && (
        <>
          <p className="text-sm text-ink-2" role="status">{t('selected_count', { count })}</p>
          <div className="ml-auto flex items-center gap-2">{actions}</div>
        </>
      )}
    </div>
  )
}
