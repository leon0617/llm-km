'use client'
/**
 * Client-side fetch wrapper that detects 401 responses from /api/* and
 * forces a redirect to /login. Used so expired JWT cookies don't leave
 * the user stuck on a half-broken page.
 *
 * Call installFetchGuard() once on the client. The guard is idempotent.
 */

let installed = false

export function installFetchGuard() {
  if (installed || typeof window === 'undefined') return
  installed = true

  const orig = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await orig(input, init)
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

    // Only intercept our own backend, and skip the /me probe (its callers handle 401 themselves).
    if (
      res.status === 401 &&
      url.startsWith('/api/') &&
      !url.startsWith('/api/auth/me') &&
      !url.startsWith('/api/auth/login') &&
      window.location.pathname !== '/login' &&
      window.location.pathname !== '/change-password'
    ) {
      const next = encodeURIComponent(window.location.pathname + window.location.search)
      window.location.replace(`/login?next=${next}`)
    }
    return res
  }
}
