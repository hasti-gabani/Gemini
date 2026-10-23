import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo } from 'react'

import { api, setUnauthorizedHandler } from '../lib/api.js'
import { translate } from '../lib/i18n.js'

const SessionContext = createContext(null)
export const SIGNED_OUT_KEY = 'ts-signed-out'

function readLocal(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback
  } catch {
    return fallback
  }
}

function writeLocal(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

function applyTheme(theme) {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  const meta = document.querySelector('meta[name="theme-color"]:not([media])')
  if (meta) meta.setAttribute('content', dark ? '#0a0f1c' : '#1d4ed8')
}

export function SessionProvider({ children }) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['session'],
    queryFn: () => api.get('/auth/session/'),
    staleTime: 10 * 60_000,
    retry: 2,
  })
  const data = query.data

  useEffect(() => {
    setUnauthorizedHandler((error) => {
      // Automatic sign-out after inactivity: tell the user why on the sign-in page.
      if (error?.data?.code === 'session_expired') {
        try {
          sessionStorage.setItem(SIGNED_OUT_KEY, error.message)
        } catch {
          /* ignore */
        }
      }
      queryClient.setQueryData(['session'], (old) => (old?.authenticated ? { ...old, authenticated: false } : old))
    })
  }, [queryClient])

  const theme = data?.settings?.theme || readLocal('ts-theme', 'system')
  const language = data?.settings?.language || readLocal('ts-lang', 'en')

  useEffect(() => {
    writeLocal('ts-theme', theme)
    applyTheme(theme)
    if (theme !== 'system') return undefined
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [theme])

  useEffect(() => {
    writeLocal('ts-lang', language)
    document.documentElement.lang = language === 'gu' ? 'gu' : 'en'
  }, [language])

  const setSession = useCallback((payload) => queryClient.setQueryData(['session'], payload), [queryClient])

  const patchSession = useCallback((patch) => {
    queryClient.setQueryData(['session'], (old) => (old ? {
      ...old,
      ...(patch.settings ? { settings: { ...old.settings, ...patch.settings } } : {}),
      ...(patch.business ? { business: { ...old.business, ...patch.business } } : {}),
      ...(patch.user ? { user: { ...old.user, ...patch.user } } : {}),
    } : old))
  }, [queryClient])

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout/')
    } finally {
      queryClient.clear()
      await queryClient.fetchQuery({ queryKey: ['session'], queryFn: () => api.get('/auth/session/') })
    }
  }, [queryClient])

  const value = useMemo(() => ({
    loading: query.isPending,
    error: query.isError ? query.error : null,
    retry: query.refetch,
    authenticated: Boolean(data?.authenticated),
    registrationOpen: data?.registration_open ?? false,
    user: data?.user || null,
    business: data?.business || null,
    settings: data?.settings || null,
    theme,
    language,
    t: (key, vars) => translate(language, key, vars),
    setSession,
    patchSession,
    logout,
  }), [query.isPending, query.isError, query.error, query.refetch, data, theme, language, setSession, patchSession,
    logout])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  const context = useContext(SessionContext)
  if (!context) throw new Error('useSession must be used inside SessionProvider')
  return context
}

export function useT() {
  const { t, language } = useSession()
  return { t, language }
}
