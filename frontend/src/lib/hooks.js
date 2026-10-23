import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from './api.js'

export function useDebounced(value, delay = 300) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}

export function useMediaQuery(query) {
  const get = () => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false)
  const [matches, setMatches] = useState(get)
  useEffect(() => {
    const media = window.matchMedia(query)
    const onChange = () => setMatches(media.matches)
    onChange()
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [query])
  return matches
}

export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)')
export const useIsWide = () => useMediaQuery('(min-width: 768px)')

/**
 * Paginated list backed by the StandardPagination API shape
 * ({count, next, results, summary}). Returns flattened rows + summary.
 */
export function usePagedList(key, path, params = {}, { enabled = true, pageSize = 30 } = {}) {
  const query = useInfiniteQuery({
    queryKey: [...key, params],
    queryFn: ({ pageParam, signal }) => api.get(path, { ...params, page: pageParam, page_size: pageSize }, { signal }),
    initialPageParam: 1,
    getNextPageParam: (last) => last?.next ?? undefined,
    enabled,
    placeholderData: (previous) => previous,
  })
  const pages = query.data?.pages || []
  return {
    ...query,
    rows: pages.flatMap((page) => page?.results || []),
    count: pages[0]?.count ?? 0,
    summary: pages[0]?.summary,
  }
}

/** Every financial change can affect balances, stock, dashboards and reports. */
export function useInvalidateAll() {
  const queryClient = useQueryClient()
  return useCallback(
    () => queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== 'session' }),
    [queryClient],
  )
}

/** Call `onVisible` when the sentinel scrolls into view (infinite lists). */
export function useOnVisible(onVisible, enabled = true) {
  const ref = useRef(null)
  const callback = useRef(onVisible)
  callback.current = onVisible
  useEffect(() => {
    const node = ref.current
    if (!node || !enabled || typeof IntersectionObserver === 'undefined') return undefined
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) callback.current()
    }, { rootMargin: '400px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [enabled])
  return ref
}

/** Warn before leaving a page with unsaved changes (browser close/reload). */
export function useBeforeUnload(active) {
  useEffect(() => {
    if (!active) return undefined
    const handler = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [active])
}

export function useLocalStorage(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw === null ? initial : JSON.parse(raw)
    } catch {
      return initial
    }
  })
  const update = useCallback((next) => {
    setValue((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next
      try {
        localStorage.setItem(key, JSON.stringify(resolved))
      } catch {
        /* storage unavailable */
      }
      return resolved
    })
  }, [key])
  return [value, update]
}
