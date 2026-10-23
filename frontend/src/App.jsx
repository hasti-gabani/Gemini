import { lazy, Suspense, useEffect, useState } from 'react'
import { createBrowserRouter, Navigate, RouterProvider, useLocation } from 'react-router'

import AppShell from './components/layout/AppShell.jsx'
import Button from './components/ui/Button.jsx'
import { ErrorState, PageLoader } from './components/ui/misc.jsx'
import { useSession } from './context/SessionContext.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Login from './pages/auth/Login.jsx'
import Register from './pages/auth/Register.jsx'
import GeminiHome from './pages/gemini/GeminiHome.jsx'

// The Gemini start screen is shown every time the app is opened: the code 0000 unlocks it only in
// memory, so a reload, a closed tab or a closed and reopened app starts at Gemini again, and it locks
// again whenever the page is hidden (another tab or app, phone screen off). Shared bill
// links (/v/…) are opened by customers and skip it. The stand-alone Gemini page (Desktop\Gemini\index.html)
// opens the app with ?gemini=open, which unlocks that one page load; the parameter is removed from the
// address before the router reads it.
const openedFromGemini = (() => {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('gemini')) return false
  url.searchParams.delete('gemini')
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  return true
})()

try { sessionStorage.removeItem('gemini-app-open') } catch { /* the old per-tab unlock is no longer used */ }

const PartyList = lazy(() => import('./pages/parties/PartyList.jsx'))
const PartyForm = lazy(() => import('./pages/parties/PartyForm.jsx'))
const PartyProfile = lazy(() => import('./pages/parties/PartyProfile.jsx'))
const ItemList = lazy(() => import('./pages/items/ItemList.jsx'))
const ItemForm = lazy(() => import('./pages/items/ItemForm.jsx'))
const ItemDetail = lazy(() => import('./pages/items/ItemDetail.jsx'))
const BillList = lazy(() => import('./pages/bills/BillList.jsx'))
const BillForm = lazy(() => import('./pages/bills/BillForm.jsx'))
const BillView = lazy(() => import('./pages/bills/BillView.jsx'))
const PaymentList = lazy(() => import('./pages/payments/PaymentList.jsx'))
const PaymentForm = lazy(() => import('./pages/payments/PaymentForm.jsx'))
const PaymentView = lazy(() => import('./pages/payments/PaymentView.jsx'))
const PaymentsHub = lazy(() => import('./pages/payments/PaymentsHub.jsx'))
const BankAccounts = lazy(() => import('./pages/bank/BankAccounts.jsx'))
const BankAccountView = lazy(() => import('./pages/bank/BankAccountView.jsx'))
const ReportsHub = lazy(() => import('./pages/reports/ReportsHub.jsx'))
const ReportView = lazy(() => import('./pages/reports/ReportView.jsx'))
const Reminders = lazy(() => import('./pages/Reminders.jsx'))
const Settings = lazy(() => import('./pages/settings/Settings.jsx'))
const PublicDocument = lazy(() => import('./pages/PublicDocument.jsx'))

function FullScreenStatus({ error, retry }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-canvas p-6">
      {error ? <ErrorState error={error} onRetry={retry} /> : <PageLoader label="Opening Gemini…" />}
    </div>
  )
}

function RequireAuth({ children }) {
  const { loading, authenticated, error, retry } = useSession()
  const location = useLocation()
  if (loading || (error && !authenticated)) return <FullScreenStatus error={error} retry={retry} />
  if (!authenticated) return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
  return children
}

function PublicOnly({ children }) {
  const { loading, authenticated } = useSession()
  const location = useLocation()
  if (loading) return <FullScreenStatus />
  if (authenticated) return <Navigate to={location.state?.from || '/'} replace />
  return children
}

function NotFound() {
  return (
    <div className="grid flex-1 place-items-center p-8 text-center">
      <div>
        <p className="text-5xl font-bold text-ink-3">404</p>
        <h1 className="mt-2 text-xl font-semibold text-ink">Page not found</h1>
        <p className="mt-1 text-ink-3">The page you opened does not exist.</p>
        <Button to="/" className="mt-5">Go to Dashboard</Button>
      </div>
    </div>
  )
}

const form = { hideNav: true }

const router = createBrowserRouter([
  { path: '/login', element: <PublicOnly><Login /></PublicOnly> },
  { path: '/register', element: <PublicOnly><Register /></PublicOnly> },
  { path: '/v/:token', element: <Suspense fallback={<FullScreenStatus />}><PublicDocument /></Suspense> },
  {
    path: '/',
    element: <RequireAuth><AppShell /></RequireAuth>,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'parties', element: <PartyList /> },
      { path: 'parties/new', element: <PartyForm />, handle: form },
      { path: 'parties/:id', element: <PartyProfile /> },
      { path: 'parties/:id/edit', element: <PartyForm />, handle: form },
      { path: 'items', element: <ItemList /> },
      { path: 'items/new', element: <ItemForm />, handle: form },
      { path: 'items/:id', element: <ItemDetail /> },
      { path: 'items/:id/edit', element: <ItemForm />, handle: form },
      { path: 'sales', element: <BillList kind="sale" /> },
      { path: 'sales/new', element: <BillForm kind="sale" />, handle: form },
      { path: 'sales/:id', element: <BillView kind="sale" />, handle: form },
      { path: 'sales/:id/edit', element: <BillForm kind="sale" />, handle: form },
      { path: 'purchases', element: <BillList kind="purchase" /> },
      { path: 'purchases/new', element: <BillForm kind="purchase" />, handle: form },
      { path: 'purchases/:id', element: <BillView kind="purchase" />, handle: form },
      { path: 'purchases/:id/edit', element: <BillForm kind="purchase" />, handle: form },
      { path: 'payments', element: <PaymentsHub /> },
      { path: 'payments-in', element: <PaymentList kind="in" /> },
      { path: 'payments-in/new', element: <PaymentForm kind="in" />, handle: form },
      { path: 'payments-in/:id', element: <PaymentView kind="in" />, handle: form },
      { path: 'payments-in/:id/edit', element: <PaymentForm kind="in" />, handle: form },
      { path: 'payments-out', element: <PaymentList kind="out" /> },
      { path: 'payments-out/new', element: <PaymentForm kind="out" />, handle: form },
      { path: 'payments-out/:id', element: <PaymentView kind="out" />, handle: form },
      { path: 'payments-out/:id/edit', element: <PaymentForm kind="out" />, handle: form },
      { path: 'bank', element: <BankAccounts /> },
      { path: 'bank/:id', element: <BankAccountView /> },
      { path: 'reports', element: <ReportsHub /> },
      { path: 'reports/:key', element: <ReportView /> },
      { path: 'reminders', element: <Reminders /> },
      { path: 'settings', element: <Settings /> },
      { path: 'settings/:section', element: <Settings />, handle: form },
      { path: '*', element: <NotFound /> },
    ],
  },
])

export default function App() {
  const [started, setStarted] = useState(openedFromGemini) // the app was opened once on this page load
  const [locked, setLocked] = useState(!openedFromGemini)
  const isPublic = window.location.pathname.startsWith('/v/')

  // Leaving the page (another tab or app, phone screen off, page restored from history) locks it again.
  useEffect(() => {
    const lock = () => setLocked(true)
    const onVisibility = () => { if (document.hidden) lock() }
    const onPageShow = (event) => { if (event.persisted) lock() }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [])

  const unlock = () => { setStarted(true); setLocked(false) }
  if (isPublic) return <RouterProvider router={router} />
  if (!started) return <GeminiHome onOpen={unlock} />
  // Once started, the app stays mounted under the Gemini screen, so an unsaved bill is not lost.
  return (
    <>
      <div hidden={locked}><RouterProvider router={router} /></div>
      {locked && <div className="fixed inset-0 z-[1000]"><GeminiHome onOpen={unlock} /></div>}
    </>
  )
}
