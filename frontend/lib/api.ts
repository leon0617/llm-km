// INTERNAL_API_BASE is set at runtime for server-side fetches (Docker internal network).
// NEXT_PUBLIC_API_BASE is baked in at build time for client-side fetches via nginx proxy.
const SERVER_BASE = process.env.INTERNAL_API_BASE || 'http://backend:8000/api'
const CLIENT_BASE = process.env.NEXT_PUBLIC_API_BASE || '/api'

const isServer = typeof window === 'undefined'
const BASE = isServer ? SERVER_BASE : CLIENT_BASE

async function get<T>(path: string): Promise<T> {
  // Forward the incoming request's cookies when called server-side, so the
  // backend can authenticate the user. Browser-side calls send cookies
  // automatically via nginx.
  const headers: Record<string, string> = {}
  if (isServer) {
    // Lazy import to avoid bundling next/headers in client code
    const { cookies } = await import('next/headers')
    const cookieStore = cookies()
    const cookieHeader = cookieStore.getAll()
      .map(c => `${c.name}=${c.value}`)
      .join('; ')
    if (cookieHeader) headers['Cookie'] = cookieHeader
  }

  const res = await fetch(`${BASE}${path}`, { cache: 'no-store', headers })
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`)
  return res.json()
}

export interface WikiPage {
  name: string
  title: string
  type: string
  updated: string
  tags: string[]
}

export interface WikiGroup {
  type: string
  label: string
  pages: WikiPage[]
}

export interface WikiTree {
  groups: WikiGroup[]
  special: WikiPage[]
  other: WikiPage[]
}

export interface PageDetail {
  name: string
  frontmatter: Record<string, unknown>
  body_markdown: string
  raw_markdown: string  // full markdown including YAML frontmatter
  backlinks: { name: string; title: string }[]
  raw_files: { name: string; url: string }[]
}

export interface SearchMatch {
  name: string
  title: string
  snippet: string
}

export const api = {
  tree: () => get<WikiTree>('/wiki/tree'),
  page: (name: string) => get<PageDetail>(`/wiki/page/${encodeURIComponent(name)}`),
  search: (q: string) => get<{ matches: SearchMatch[] }>(`/wiki/search?q=${encodeURIComponent(q)}`),
  health: () => get<{ status: string; wiki_pages: number }>('/health'),
}
