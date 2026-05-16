'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

// roles: array of roles allowed to see this nav item (admin always allowed)
interface NavItem { href: string; icon: string; label: string; count?: number; roles?: string[] }

const MAIN: NavItem[] = [
  { href: '/query', icon: 'forum', label: '聊天查詢', roles: ['admin', 'editor', 'user'] },
  { href: '/browse', icon: 'menu_book', label: 'Wiki 瀏覽', roles: ['admin', 'editor', 'user'] },
  { href: '/ingest', icon: 'upload_file', label: '文件上傳', roles: ['admin', 'editor'] },
]

const ADMIN: NavItem[] = [
  { href: '/admin', icon: 'group', label: '帳號管理', roles: ['admin'] },
  { href: '/admin/operations', icon: 'play_circle', label: '批次操作', roles: ['admin'] },
  { href: '/admin/usage', icon: 'monitoring', label: '用量統計', roles: ['admin'] },
  { href: '/admin/audit', icon: 'history', label: '操作日誌', roles: ['admin'] },
]

export default function AppSidebar() {
  const pathname = usePathname()
  const [user, setUser] = useState<{ role: string } | null>(null)
  const [stats, setStats] = useState<{ wiki_pages: number } | null>(null)

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(d => d && setUser(d)).catch(() => {})
    fetch('/api/health').then(r => r.json()).then(setStats).catch(() => {})
  }, [])

  const role = user?.role || ''
  const isAdmin = role === 'admin'
  const canSee = (item: NavItem) => !item.roles || item.roles.includes(role)
  const visibleMain = MAIN.filter(canSee)

  function NavLink({ item }: { item: NavItem }) {
    // Exact-match for /admin to avoid /admin/audit also matching it
    const active = item.href === '/admin'
      ? pathname === '/admin'
      : (pathname === item.href || pathname.startsWith(item.href + '/'))
    return (
      <Link href={item.href} className={`sb-item ${active ? 'active' : ''}`}>
        <span className="material-symbols-outlined">{item.icon}</span>
        {item.label}
        {item.count !== undefined && <span className="count">{item.count}</span>}
      </Link>
    )
  }

  return (
    <aside className="sidebar">
      <div className="sb-section-title">主功能</div>
      <div className="sb-list">
        {visibleMain.map(item => <NavLink key={item.href} item={item} />)}
      </div>

      {isAdmin && (
        <>
          <div className="sb-divider" />
          <div className="sb-section-title">系統管理</div>
          <div className="sb-list">
            {ADMIN.map(item => <NavLink key={item.href} item={item} />)}
          </div>
        </>
      )}

      <div className="sb-footer">
        <div className="sb-foot-title">
          <span className="material-symbols-outlined">check_circle</span>
          系統運行正常
        </div>
        <div className="sb-foot-meta">
          <div className="row"><span>Wiki 頁數</span><b>{stats?.wiki_pages ?? '—'}</b></div>
          <div className="row"><span>Anthropic</span><b>連線正常</b></div>
        </div>
      </div>

      <style jsx>{`
        .sidebar {
          width: 248px; flex-shrink: 0;
          background: #fff;
          border: 1px solid var(--border-default);
          border-radius: var(--radius-xl);
          display: flex; flex-direction: column;
          overflow: hidden;
        }
        .sb-section-title {
          padding: 16px 18px 8px;
          font-size: 10px; letter-spacing: 1.4px; text-transform: uppercase;
          color: var(--text-secondary); font-weight: 600;
          font-family: var(--font-family-mono);
        }
        .sb-list { display: flex; flex-direction: column; gap: 1px; padding: 0 8px; }

        .sidebar :global(.sb-item) {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 12px; border-radius: 6px;
          color: var(--text-primary); text-decoration: none;
          font-size: 13.5px; cursor: pointer;
          transition: background 120ms, color 120ms;
          font-weight: 400;
        }
        .sidebar :global(.sb-item:hover) { background: rgba(40,119,238,.06); }
        .sidebar :global(.sb-item .material-symbols-outlined) { font-size: 20px; color: var(--text-secondary); }
        .sidebar :global(.sb-item .count) {
          margin-left: auto;
          font-size: 11px; padding: 1px 8px; border-radius: 999px;
          background: var(--bg-surface-variant); color: var(--text-secondary);
          font-variant-numeric: tabular-nums;
          font-family: var(--font-family-mono);
        }
        .sidebar :global(.sb-item.active) {
          background: rgb(var(--color-sf-primary-container));
          color: rgb(var(--color-sf-on-primary-container));
          font-weight: 500;
        }
        .sidebar :global(.sb-item.active .material-symbols-outlined) {
          color: rgb(var(--color-sf-on-primary-container));
          font-variation-settings: 'FILL' 1, 'wght' 500, 'GRAD' 0, 'opsz' 24;
        }

        .sb-divider { height: 1px; background: var(--border-default); margin: 12px 14px; }

        .sb-footer {
          margin-top: auto;
          padding: 14px 16px;
          border-top: 1px solid var(--border-default);
          background: linear-gradient(0deg, rgba(40,119,238,.04), rgba(40,119,238,.04)), #fff;
        }
        .sb-foot-title { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; }
        .sb-foot-title :global(.material-symbols-outlined) { font-size: 16px; color: rgb(var(--color-sf-success)); }
        .sb-foot-meta {
          font-size: 11px; color: var(--text-secondary); margin-top: 4px; line-height: 1.5;
          font-family: var(--font-family-mono);
        }
        .sb-foot-meta .row { display: flex; justify-content: space-between; }
        .sb-foot-meta b { color: var(--text-primary); font-weight: 500; }
      `}</style>
    </aside>
  )
}
