'use client'
import { useState, useEffect, useCallback } from 'react'
import AppShell from '@/components/AppShell'

interface AuditEntry {
  id: number
  ts: string
  actor: string | null
  action: string
  target: string | null
  outcome: string
  ip: string | null
  user_agent: string | null
  details: Record<string, unknown> | string | null
}

interface AuditStats {
  days: number
  by_action: Record<string, number>
  failures: number
}

const ACTION_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  'auth.login': { label: '登入', icon: 'login', color: 'rgb(var(--color-sf-primary))' },
  'auth.logout': { label: '登出', icon: 'logout', color: 'var(--text-secondary)' },
  'auth.change_password': { label: '改密碼', icon: 'key', color: 'rgb(247,144,9)' },
  'admin.user_create': { label: '建立使用者', icon: 'person_add', color: 'rgb(18,183,106)' },
  'admin.user_delete': { label: '刪除使用者', icon: 'person_remove', color: 'rgb(244,73,62)' },
  'admin.user_activate': { label: '啟用使用者', icon: 'check_circle', color: 'rgb(18,183,106)' },
  'admin.user_deactivate': { label: '停用使用者', icon: 'block', color: 'rgb(244,73,62)' },
  'admin.user_reset_password': { label: '重設密碼', icon: 'lock_reset', color: 'rgb(247,144,9)' },
  'query.ask': { label: '查詢', icon: 'forum', color: 'rgb(var(--color-sf-primary))' },
  'ingest.start': { label: 'Ingest 啟動', icon: 'upload_file', color: '#7B3FA8' },
  'ingest.complete': { label: 'Ingest 完成', icon: 'task_alt', color: 'rgb(18,183,106)' },
  'ingest.fail': { label: 'Ingest 失敗', icon: 'error', color: 'rgb(244,73,62)' },
}

const OUTCOME_LABEL: Record<string, { label: string; cls: string }> = {
  success: { label: '成功', cls: 'badge-active' },
  failure: { label: '失敗', cls: 'badge-inactive' },
  denied: { label: '拒絕', cls: 'badge-pending' },
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = (now.getTime() - d.getTime()) / 1000
  if (diff < 60) return `${Math.floor(diff)} 秒前`
  if (diff < 3600) return `${Math.floor(diff / 60)} 分前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小時前`
  return d.toISOString().slice(0, 16).replace('T', ' ')
}

export default function AuditPage() {
  const [items, setItems] = useState<AuditEntry[]>([])
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState<AuditStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [filterAction, setFilterAction] = useState<string>('')
  const [filterActor, setFilterActor] = useState('')
  const [filterOutcome, setFilterOutcome] = useState('')
  const [page, setPage] = useState(0)
  const [expanded, setExpanded] = useState<number | null>(null)
  const PER_PAGE = 50

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({
      limit: String(PER_PAGE),
      offset: String(page * PER_PAGE),
    })
    if (filterAction) params.set('action', filterAction)
    if (filterActor) params.set('actor', filterActor)
    if (filterOutcome) params.set('outcome', filterOutcome)
    const res = await fetch(`/api/admin/audit?${params}`)
    if (res.ok) {
      const data = await res.json()
      setItems(data.items)
      setTotal(data.total)
    }
    setLoading(false)
  }, [filterAction, filterActor, filterOutcome, page])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    fetch('/api/admin/audit/stats?days=7').then(r => r.ok ? r.json() : null).then(d => d && setStats(d))
  }, [items])

  const totalPages = Math.ceil(total / PER_PAGE)

  return (
    <AppShell crumbs={[{ label: '系統管理', href: '/admin' }, { label: '操作日誌' }]}>
      <div className="content">
        <div className="page-head">
          <div className="title-block">
            <h1>操作日誌</h1>
            <div className="desc">
              系統所有寫入操作與登入嘗試的完整記錄。儲存於 <code className="code">/data/audit.db</code>，僅管理員可查看。
            </div>
          </div>
          <div className="actions">
            <button className="btn btn-outline" onClick={load}>
              <span className="material-symbols-outlined">refresh</span>重新整理
            </button>
          </div>
        </div>

        {/* Stat row */}
        {stats && (
          <div className="stat-row">
            <div className="stat">
              <div className="label"><span className="material-symbols-outlined">history</span>近 7 天紀錄</div>
              <div className="value">{Object.values(stats.by_action).reduce((a, b) => a + b, 0)}</div>
              <div className="delta">{Object.keys(stats.by_action).length} 種操作</div>
            </div>
            <div className="stat">
              <div className="label"><span className="material-symbols-outlined">login</span>登入</div>
              <div className="value">{stats.by_action['auth.login'] || 0}</div>
              <div className="delta">含成功與失敗</div>
            </div>
            <div className="stat">
              <div className="label"><span className="material-symbols-outlined">forum</span>查詢</div>
              <div className="value">{stats.by_action['query.ask'] || 0}</div>
              <div className="delta">{stats.by_action['ingest.complete'] || 0} 次 ingest 完成</div>
            </div>
            <div className="stat">
              <div className="label"><span className="material-symbols-outlined">error</span>異常</div>
              <div className="value" style={{ color: stats.failures > 0 ? 'rgb(var(--color-sf-error))' : undefined }}>
                {stats.failures}
              </div>
              <div className="delta">失敗或被拒絕</div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="toolbar">
          <button className={`filter-pill ${!filterAction ? 'active' : ''}`} onClick={() => { setFilterAction(''); setPage(0) }}>
            全部 <span className="ct">{total}</span>
          </button>
          <button className={`filter-pill ${filterAction === 'auth.login' ? 'active' : ''}`} onClick={() => { setFilterAction('auth.login'); setPage(0) }}>
            <span className="material-symbols-outlined">login</span>登入
          </button>
          <button className={`filter-pill ${filterAction === 'query.ask' ? 'active' : ''}`} onClick={() => { setFilterAction('query.ask'); setPage(0) }}>
            <span className="material-symbols-outlined">forum</span>查詢
          </button>
          <button className={`filter-pill ${filterAction === 'ingest.start' ? 'active' : ''}`} onClick={() => { setFilterAction('ingest.start'); setPage(0) }}>
            <span className="material-symbols-outlined">upload_file</span>Ingest
          </button>
          <button className={`filter-pill ${filterAction.startsWith('admin.') ? 'active' : ''}`} onClick={() => { setFilterAction('admin.user_create'); setPage(0) }}>
            <span className="material-symbols-outlined">manage_accounts</span>管理操作
          </button>
          <button className={`filter-pill ${filterOutcome === 'failure' ? 'active' : ''}`} onClick={() => { setFilterOutcome(filterOutcome === 'failure' ? '' : 'failure'); setPage(0) }}>
            <span className="material-symbols-outlined" style={{ color: 'rgb(var(--color-sf-error))' }}>error</span>
            僅看失敗
          </button>

          <div className="tb-search">
            <span className="material-symbols-outlined">person_search</span>
            <input value={filterActor}
              onChange={e => { setFilterActor(e.target.value); setPage(0) }}
              placeholder="搜尋操作者帳號…" />
          </div>
        </div>

        {/* Table */}
        <div className="grid-wrap">
          {loading ? (
            <div className="empty-state">
              <span className="material-symbols-outlined ic">hourglass_top</span>
              <p>載入中…</p>
            </div>
          ) : items.length === 0 ? (
            <div className="empty-state">
              <span className="material-symbols-outlined ic">inbox</span>
              <p>沒有符合條件的紀錄</p>
            </div>
          ) : (
            <>
              <table className="grid">
                <thead>
                  <tr>
                    <th style={{ width: 120 }}>時間</th>
                    <th style={{ width: 110 }}>操作者</th>
                    <th>操作</th>
                    <th>目標</th>
                    <th style={{ width: 80 }}>結果</th>
                    <th style={{ width: 130 }}>IP</th>
                    <th style={{ width: 36 }} />
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => {
                    const a = ACTION_LABELS[item.action] || { label: item.action, icon: 'circle', color: 'var(--text-secondary)' }
                    const o = OUTCOME_LABEL[item.outcome] || { label: item.outcome, cls: 'badge-draft' }
                    const isOpen = expanded === item.id
                    return (
                      <>
                        <tr key={item.id} className={isOpen ? 'expanded' : ''}>
                          <td className="time-cell">
                            <div className="ago">{formatTime(item.ts)}</div>
                            <div className="abs">{item.ts.slice(11, 19)}</div>
                          </td>
                          <td>
                            <span className="actor">{item.actor || <span className="muted">—</span>}</span>
                          </td>
                          <td>
                            <div className="action-cell">
                              <span className="material-symbols-outlined" style={{ color: a.color }}>{a.icon}</span>
                              {a.label}
                            </div>
                          </td>
                          <td>
                            <span className="target">{item.target || <span className="muted">—</span>}</span>
                          </td>
                          <td>
                            <span className={`badge ${o.cls}`}>{o.label}</span>
                          </td>
                          <td>
                            <span className="ip">{item.ip || <span className="muted">—</span>}</span>
                          </td>
                          <td>
                            <button className="ra-btn" onClick={() => setExpanded(isOpen ? null : item.id)}
                              title="展開詳細">
                              <span className="material-symbols-outlined">{isOpen ? 'expand_less' : 'expand_more'}</span>
                            </button>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr key={`${item.id}-detail`} className="detail-row">
                            <td colSpan={7}>
                              <div className="detail-grid">
                                {item.user_agent && (
                                  <>
                                    <div className="k">User-Agent</div>
                                    <div className="v">{item.user_agent}</div>
                                  </>
                                )}
                                {item.details && (
                                  <>
                                    <div className="k">詳細資料</div>
                                    <div className="v">
                                      <pre>{JSON.stringify(item.details, null, 2)}</pre>
                                    </div>
                                  </>
                                )}
                                <div className="k">完整時間</div>
                                <div className="v"><code className="code">{item.ts}</code></div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    )
                  })}
                </tbody>
              </table>

              {totalPages > 1 && (
                <div className="pager">
                  <button className="pg-btn" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                    <span className="material-symbols-outlined">chevron_left</span>
                  </button>
                  <span className="pg-info">
                    第 {page + 1} / {totalPages} 頁（共 {total} 筆）
                  </span>
                  <button className="pg-btn" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                    <span className="material-symbols-outlined">chevron_right</span>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <style jsx>{`
        .content { flex: 1; overflow-y: auto; padding-bottom: 12px; }
        .page-head { padding: 24px 28px 0; display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; flex-wrap: wrap; }
        .page-head h1 { margin: 0 0 4px; font-size: 24px; font-weight: 500; letter-spacing: -0.2px; }
        .page-head .desc { font-size: 13px; color: var(--text-secondary); max-width: 720px; }
        .actions { display: flex; gap: 8px; }

        .stat-row { padding: 20px 28px 0; display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
        .stat { border: 1px solid var(--border-default); border-radius: 8px; padding: 14px 16px; background: #fff; display: flex; flex-direction: column; gap: 2px; }
        .stat .label { font-size: 12px; color: var(--text-secondary); display: flex; align-items: center; gap: 6px; }
        .stat .label :global(.material-symbols-outlined) { font-size: 16px; }
        .stat .value { font-size: 26px; font-weight: 500; line-height: 1.2; font-variant-numeric: tabular-nums; }
        .stat .delta { font-size: 11px; font-family: var(--font-family-mono); color: var(--text-secondary); margin-top: 2px; }

        .toolbar {
          display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
          padding: 16px 28px; margin-top: 20px;
          border-top: 1px solid var(--border-default);
          background: linear-gradient(0deg, rgba(40,119,238,.025), rgba(40,119,238,.025)), #fff;
        }
        .filter-pill {
          height: 32px; display: inline-flex; align-items: center; gap: 6px;
          padding: 0 12px; border-radius: 999px;
          border: 1px solid var(--border-default); background: #fff;
          font-size: 13px; cursor: pointer; transition: all 120ms;
          color: var(--text-primary); font-family: inherit;
        }
        .filter-pill:hover { border-color: var(--border-strong); }
        .filter-pill.active {
          background: rgb(var(--color-sf-primary-container));
          color: rgb(var(--color-sf-on-primary-container));
          border-color: transparent; font-weight: 500;
        }
        .filter-pill :global(.material-symbols-outlined) { font-size: 16px; }
        .filter-pill .ct { font-family: var(--font-family-mono); font-size: 11px; opacity: .7; }

        .tb-search { margin-left: auto; position: relative; width: 240px; }
        .tb-search input {
          height: 32px; width: 100%; padding: 0 12px 0 32px;
          border: 1px solid var(--border-default); border-radius: 6px;
          font: inherit; font-size: 13px; background: #fff;
          outline: none; transition: border-color 120ms;
        }
        .tb-search input:focus {
          border-color: rgb(var(--color-sf-primary));
          box-shadow: 0 0 0 4px rgba(40,119,238,.16);
        }
        .tb-search :global(.material-symbols-outlined) {
          position: absolute; left: 8px; top: 50%; transform: translateY(-50%);
          font-size: 16px; color: var(--text-secondary);
        }

        .grid-wrap { padding: 0 28px 12px; }
        .grid { width: 100%; border-collapse: collapse; font-size: 13px; }
        .grid thead th {
          background: linear-gradient(0deg, rgba(40,119,238,.05), rgba(40,119,238,.05)), #fff;
          height: 40px; padding: 0 14px;
          text-align: left; font-weight: 500; font-size: 12.5px;
          color: var(--text-primary);
          border-top: 1px solid var(--border-default);
          border-bottom: 1px solid var(--border-default);
          white-space: nowrap;
        }
        .grid tbody td {
          height: 48px; padding: 0 14px;
          border-bottom: 1px solid var(--border-default);
          vertical-align: middle;
        }
        .grid tbody tr:hover td { background: rgba(40,119,238,.04); }
        .grid tbody tr.expanded td { background: rgba(40,119,238,.06); }

        .time-cell .ago { font-size: 12.5px; }
        .time-cell .abs { font-size: 10.5px; color: var(--text-secondary); font-family: var(--font-family-mono); }
        .actor { font-family: var(--font-family-mono); font-size: 12.5px; font-weight: 500; }
        .action-cell { display: flex; align-items: center; gap: 8px; }
        .action-cell :global(.material-symbols-outlined) { font-size: 18px; }
        .target { font-family: var(--font-family-mono); font-size: 12px; color: var(--text-secondary); }
        .ip { font-family: var(--font-family-mono); font-size: 11.5px; color: var(--text-secondary); }
        .muted { color: var(--border-strong); }

        .badge {
          display: inline-flex; padding: 2px 8px; border-radius: 4px;
          font-size: 11px; font-weight: 500; border: 1px solid;
        }
        .badge-active { background: rgba(18,183,106,.12); color: rgb(var(--color-sf-success)); border-color: rgb(var(--color-sf-success)); }
        .badge-inactive { background: rgba(244,73,62,.12); color: rgb(var(--color-sf-danger)); border-color: rgb(var(--color-sf-danger)); }
        .badge-pending { background: rgba(247,144,9,.12); color: rgb(var(--color-sf-warning)); border-color: rgb(var(--color-sf-warning)); }
        .badge-draft { background: rgba(15,23,42,.08); color: var(--text-secondary); border-color: var(--border-strong); }

        .ra-btn {
          width: 28px; height: 28px; border-radius: 4px;
          border: 0; background: transparent; cursor: pointer;
          color: var(--text-secondary);
          display: grid; place-items: center;
        }
        .ra-btn:hover { background: rgba(15,23,42,.08); color: var(--text-primary); }
        .ra-btn .material-symbols-outlined { font-size: 16px; }

        .detail-row td { padding: 12px 14px 16px; background: rgba(40,119,238,.025); border-bottom: 1px solid var(--border-default); }
        .detail-grid {
          display: grid; grid-template-columns: 100px 1fr; gap: 6px 16px;
          font-size: 12px; padding-left: 36px;
        }
        .detail-grid .k { color: var(--text-secondary); font-family: var(--font-family-mono); padding-top: 2px; }
        .detail-grid .v { color: var(--text-primary); }
        .detail-grid pre {
          margin: 0; padding: 8px 12px;
          background: #fff; border: 1px solid var(--border-default); border-radius: 6px;
          font-family: var(--font-family-mono); font-size: 11.5px;
          overflow-x: auto; max-height: 200px;
        }

        .empty-state { padding: 60px 28px; text-align: center; color: var(--text-secondary); }
        .empty-state .ic { font-size: 48px; opacity: .4; }
        .empty-state p { margin: 8px 0 0; }

        .pager {
          display: flex; align-items: center; justify-content: center; gap: 12px;
          padding: 16px 0;
          font-size: 12px; color: var(--text-secondary);
        }
        .pg-btn {
          width: 32px; height: 32px; border-radius: 6px;
          border: 1px solid var(--border-default); background: #fff;
          cursor: pointer; display: grid; place-items: center;
          color: var(--text-primary);
        }
        .pg-btn:hover:not(:disabled) { border-color: rgb(var(--color-sf-primary)); color: rgb(var(--color-sf-primary)); }
        .pg-btn:disabled { opacity: .4; cursor: not-allowed; }
        .pg-info { font-family: var(--font-family-mono); }
      `}</style>
    </AppShell>
  )
}
