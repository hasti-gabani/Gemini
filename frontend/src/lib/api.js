/**
 * Thin fetch wrapper for the Django API (same-origin session auth + CSRF).
 * Errors are thrown as ApiError with the server's friendly `detail` message and
 * a flat `errors` map of field path -> message (e.g. "items.0.quantity").
 */

export class ApiError extends Error {
  constructor(status, message, errors = {}, data = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.errors = errors || {}
    this.data = data
  }
}

let unauthorizedHandler = null
export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn
}

export function getCookie(name) {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&') + '=([^;]*)'))
  return match ? decodeURIComponent(match[1]) : ''
}

export function apiUrl(path, params) {
  const search = new URLSearchParams()
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue
      search.set(key, String(value))
    }
  }
  const query = search.toString()
  return `/api${path}${query ? `?${query}` : ''}`
}

const STATUS_MESSAGES = {
  400: 'Please check the details and try again.',
  403: 'You do not have permission to do this.',
  404: 'Record not found. It may have been deleted.',
  409: 'This record is in use and cannot be changed.',
  413: 'The file is too large.',
  429: 'Too many attempts. Please wait a minute and try again.',
  500: 'Something went wrong on the server. Please try again.',
}

async function parseError(res) {
  let data = null
  try {
    data = await res.json()
  } catch {
    /* not JSON */
  }
  const message = data?.detail || STATUS_MESSAGES[res.status] || `Request failed (${res.status}).`
  const error = new ApiError(res.status, message, data?.errors, data)
  if ((res.status === 401 || res.status === 403) && /sign in/i.test(message)) {
    unauthorizedHandler?.(error)
  }
  return error
}

export async function request(path, { method = 'GET', body, params, signal, raw = false, headers: extra } = {}) {
  const headers = { Accept: 'application/json', ...extra }
  let payload
  if (body instanceof FormData) {
    payload = body
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  if (method !== 'GET' && method !== 'HEAD') {
    headers['X-CSRFToken'] = getCookie('gemini_csrftoken')
  }
  let res
  try {
    res = await fetch(apiUrl(path, params), { method, headers, body: payload, credentials: 'same-origin', signal })
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.')
  }
  if (!res.ok) throw await parseError(res)
  if (raw) return res
  if (res.status === 204) return null
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

export const api = {
  get: (path, params, options) => request(path, { params, ...options }),
  post: (path, body, options) => request(path, { method: 'POST', body, ...options }),
  put: (path, body, options) => request(path, { method: 'PUT', body, ...options }),
  patch: (path, body, options) => request(path, { method: 'PATCH', body, ...options }),
  del: (path, params, options) => request(path, { method: 'DELETE', params, ...options }),
}

/** First error message for a field path, also matching nested paths ("items.0" matches "items.0.rate"). */
export function fieldError(errors, path) {
  if (!errors) return ''
  if (errors[path]) return errors[path]
  const prefix = `${path}.`
  const key = Object.keys(errors).find((k) => k.startsWith(prefix))
  return key ? errors[key] : ''
}
