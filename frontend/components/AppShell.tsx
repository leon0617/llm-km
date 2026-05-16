'use client'
import { ReactNode, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import AppHeader from './AppHeader'
import AppSidebar from './AppSidebar'
import { installFetchGuard } from '@/lib/fetch-guard'

interface Props {
  children: ReactNode
  crumbs?: { label: string; href?: string }[]
  hideSidebar?: boolean
}

export default function AppShell({ children, crumbs, hideSidebar = false }: Props) {
  const router = useRouter()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    installFetchGuard()
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(d => {
      if (!d) {
        router.push('/login')
        return
      }
      if (d.must_change_password) {
        router.push('/change-password')
        return
      }
      setReady(true)
    }).catch(() => router.push('/login'))
  }, [router])

  if (!ready) {
    return (
      <div style={{
        height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-secondary)', fontSize: 13,
      }}>
        載入中…
      </div>
    )
  }

  return (
    <div className="app">
      <AppHeader crumbs={crumbs} />

      <div className="app-body">
        {!hideSidebar && <AppSidebar />}
        <main className="main">{children}</main>
      </div>

      <footer className="app-foot">
        <div className="left">
          <span className="stat-dot">服務正常</span>
          <span>leonl-km.lbest.online</span>
        </div>
        <div className="right">
          <span>v1.0.0</span>
          <span>© 2026 LLM Wiki</span>
        </div>
      </footer>

      <style jsx>{`
        .app {
          display: flex; flex-direction: column;
          height: 100vh; height: 100dvh;
          background-image:
            linear-gradient(90deg, rgba(40,119,238,.05), rgba(40,119,238,.05)),
            linear-gradient(90deg, #fff, #fff);
        }
        .app-body {
          flex: 1; display: flex; min-height: 0;
          padding: 8px; gap: 8px;
        }
        .main {
          flex: 1; min-width: 0;
          background: #fff;
          border: 1px solid var(--border-default);
          border-radius: var(--radius-xl);
          display: flex; flex-direction: column;
          overflow: hidden;
        }
        .app-foot {
          height: 24px; flex-shrink: 0;
          display: flex; align-items: center; justify-content: space-between;
          padding: 0 16px;
          font-size: 11px; font-family: var(--font-family-mono);
          color: var(--text-secondary);
          background: linear-gradient(90deg, rgba(40,119,238,.05), rgba(40,119,238,.05));
          border-top: 1px solid var(--border-default);
          letter-spacing: 0.4px;
        }
        .app-foot .left, .app-foot .right { display: flex; align-items: center; gap: 16px; }
        .stat-dot { display: inline-flex; align-items: center; gap: 4px; }
        .stat-dot::before {
          content: ''; width: 6px; height: 6px; border-radius: 50%;
          background: rgb(var(--color-sf-success));
        }
      `}</style>
    </div>
  )
}
