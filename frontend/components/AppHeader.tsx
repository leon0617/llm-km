'use client'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'

interface Crumb { label: string; href?: string }
interface Props { crumbs?: Crumb[] }

export default function AppHeader({ crumbs }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [q, setQ] = useState('')
  const [user, setUser] = useState<{ display_name: string; role: string; username: string } | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(d => d && setUser(d)).catch(() => {})
  }, [])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (q.trim().length < 2) return
    router.push(`/browse?q=${encodeURIComponent(q.trim())}`)
  }

  // Auto-derive breadcrumbs from pathname if not given
  const computedCrumbs = crumbs ?? (() => {
    const map: Record<string, string> = {
      query: '聊天查詢',
      browse: 'Wiki 瀏覽',
      ingest: '文件上傳',
      admin: '系統管理',
    }
    const parts = pathname.split('/').filter(Boolean)
    return parts.map((p, i) => ({
      label: map[p] || decodeURIComponent(p),
      href: i < parts.length - 1 ? '/' + parts.slice(0, i + 1).join('/') : undefined,
    }))
  })()

  const initials = (user?.display_name || '?').slice(0, 2).toUpperCase()

  return (
    <header className="app-header">
      <Link href="/query" className="brand">
        <div className="mark">KM</div>
        <div>
          <div className="product-title">LLM Wiki</div>
          <div className="product-sub">內部知識庫</div>
        </div>
      </Link>

      {computedCrumbs.length > 0 && (
        <nav className="crumbs">
          {computedCrumbs.map((c, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {i > 0 && <span className="material-symbols-outlined sep" style={{ fontSize: 16 }}>chevron_right</span>}
              {c.href ? (
                <Link href={c.href} style={{ color: 'inherit', textDecoration: 'none' }}>{c.label}</Link>
              ) : (
                <span className="here">{c.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}

      <form onSubmit={handleSearch} className="header-search">
        <span className="material-symbols-outlined">search</span>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜尋頁面、實體、概念…" />
        <span className="kbd">⌘ K</span>
      </form>

      <div className="header-actions">
        <button className="icon-btn" title="使用說明">
          <span className="material-symbols-outlined">help_outline</span>
        </button>
        <button className="icon-btn" title="通知">
          <span className="material-symbols-outlined">notifications</span>
        </button>
        {user?.role === 'admin' && (
          <Link href="/admin" className="icon-btn" title="設定">
            <span className="material-symbols-outlined">settings</span>
          </Link>
        )}

        <div ref={menuRef} style={{ position: 'relative' }}>
          <button className="user-chip" onClick={() => setMenuOpen(o => !o)}>
            <span className="avatar">{initials}</span>
            <div className="who">
              <div>{user?.display_name || '…'}</div>
              <div className="role">{user?.username} · {
                user?.role === 'admin' ? '管理員'
                  : user?.role === 'editor' ? '編輯者'
                  : '一般使用者'
              }</div>
            </div>
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: 'var(--text-secondary)' }}>expand_more</span>
          </button>

          {menuOpen && (
            <div className="user-menu">
              {user?.role === 'admin' && (
                <Link href="/admin" onClick={() => setMenuOpen(false)} className="menu-item">
                  <span className="material-symbols-outlined">manage_accounts</span>
                  使用者管理
                </Link>
              )}
              <button onClick={logout} className="menu-item danger">
                <span className="material-symbols-outlined">logout</span>
                登出
              </button>
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .app-header {
          height: 60px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 0 20px;
          background: linear-gradient(0deg, rgba(40,119,238,.05), rgba(40,119,238,.05)), #fff;
          border-bottom: 1px solid var(--border-default);
          color: var(--text-primary);
        }
        .brand {
          display: flex; align-items: center; gap: 10px; min-width: 220px;
          text-decoration: none; color: inherit;
        }
        .mark {
          width: 32px; height: 32px; border-radius: 8px;
          background: rgb(var(--color-sf-on-primary-container));
          color: #fff; display: grid; place-items: center;
          font-weight: 700; font-size: 13px; letter-spacing: 0.5px;
        }
        .product-title { font-size: 15px; font-weight: 600; line-height: 1.1; }
        .product-sub {
          font-size: 11px; color: var(--text-secondary);
          font-family: var(--font-family-mono); letter-spacing: 0.4px; margin-top: 2px;
        }
        .crumbs {
          display: flex; align-items: center; gap: 6px;
          font-size: 13px; color: var(--text-secondary); margin-left: 12px;
        }
        .crumbs .sep { opacity: .4; }
        .crumbs :global(.here) { color: var(--text-primary); font-weight: 500; }

        .header-search {
          margin-left: auto; width: 320px; position: relative;
        }
        .header-search input {
          height: 36px; width: 100%;
          padding: 0 36px 0 36px;
          background: rgba(15,23,42,.04);
          border: 1px solid transparent;
          border-radius: 6px;
          font-family: inherit; font-size: 13px; color: var(--text-primary);
          outline: none; transition: background 150ms, border-color 150ms;
        }
        .header-search input:focus {
          background: #fff; border-color: rgb(var(--color-sf-primary));
          box-shadow: 0 0 0 4px rgba(40,119,238,.16);
        }
        .header-search :global(.material-symbols-outlined) {
          position: absolute; left: 10px; top: 50%; transform: translateY(-50%);
          font-size: 18px; color: var(--text-secondary);
        }
        .kbd {
          position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
          font-family: var(--font-family-mono); font-size: 10px;
          padding: 2px 6px; background: #fff; border: 1px solid var(--border-default);
          border-radius: 3px; color: var(--text-secondary);
        }

        .header-actions { display: flex; align-items: center; gap: 4px; }
        .icon-btn {
          width: 36px; height: 36px; border-radius: 6px;
          background: transparent; border: 0; cursor: pointer;
          display: grid; place-items: center;
          color: var(--text-secondary);
          transition: background 120ms, color 120ms;
          text-decoration: none;
        }
        .icon-btn:hover { background: rgba(15,23,42,.06); color: var(--text-primary); }

        .user-chip {
          display: flex; align-items: center; gap: 8px;
          padding: 4px 10px 4px 4px; border-radius: 999px;
          border: 1px solid var(--border-default); background: #fff; cursor: pointer;
          transition: border-color 120ms;
        }
        .user-chip:hover { border-color: rgb(var(--color-sf-primary)); }
        .avatar {
          width: 28px; height: 28px; border-radius: 50%;
          background: linear-gradient(135deg, rgb(var(--color-sf-primary)), rgb(var(--color-sf-on-primary-container)));
          color: #fff; display: grid; place-items: center;
          font-size: 12px; font-weight: 600;
        }
        .who { font-size: 13px; line-height: 1.1; text-align: left; }
        .who .role {
          font-size: 10px; color: var(--text-secondary);
          font-family: var(--font-family-mono); margin-top: 2px;
        }

        .user-menu {
          position: absolute; right: 0; top: calc(100% + 6px);
          width: 200px;
          background: #fff;
          border: 1px solid var(--border-default);
          border-radius: 8px;
          box-shadow: var(--shadow-e2);
          padding: 4px;
          z-index: 50;
        }
        .menu-item {
          display: flex; align-items: center; gap: 10px;
          width: 100%; padding: 8px 12px;
          background: transparent; border: 0; cursor: pointer;
          text-decoration: none; color: var(--text-primary);
          font: inherit; font-size: 13px;
          border-radius: 4px; transition: background 120ms;
        }
        .menu-item :global(.material-symbols-outlined) { font-size: 16px; color: var(--text-secondary); }
        .menu-item:hover { background: rgba(15,23,42,.06); }
        .menu-item.danger { color: rgb(var(--color-sf-error)); }
        .menu-item.danger :global(.material-symbols-outlined) { color: rgb(var(--color-sf-error)); }
      `}</style>
    </header>
  )
}
