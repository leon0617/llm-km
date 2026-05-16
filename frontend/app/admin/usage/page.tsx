'use client'
import { useState, useEffect, useCallback } from 'react'
import AppShell from '@/components/AppShell'

interface Bucket {
  username?: string
  day?: string
  tokens_in: number
  tokens_out: number
  messages: number
  cost_usd: number
}

interface Usage {
  days: number
  total: { tokens_in: number; tokens_out: number; messages: number; cost_usd: number }
  by_user: Bucket[]
  by_day: Bucket[]
  pricing: { input_per_m_usd: number; output_per_m_usd: number }
}

function fmt(n: number): string {
  if (n < 1000) return n.toString()
  if (n < 1_000_000) return (n / 1000).toFixed(1) + 'k'
  return (n / 1_000_000).toFixed(2) + 'M'
}

export default function UsagePage() {
  const [usage, setUsage] = useState<Usage | null>(null)
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(true)
  const [queue, setQueue] = useState<{
    providers: {
      name: string; model: string; tier: string; weight: number;
      max_concurrent: number; in_use: number; waiting: number;
      fail_count: number; healthy: boolean
    }[]
    total_max_concurrent: number
    total_in_use: number
    total_waiting: number
    routing: string
  } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const r = await fetch(`/api/admin/usage?days=${days}`)
    if (r.ok) setUsage(await r.json())
    setLoading(false)
  }, [days])

  const loadQueue = useCallback(async () => {
    const r = await fetch('/api/admin/llm/queue')
    if (r.ok) setQueue(await r.json())
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    loadQueue()
    const t = setInterval(loadQueue, 5000)
    return () => clearInterval(t)
  }, [loadQueue])

  const maxDayUsage = usage ? Math.max(1, ...usage.by_day.map(d => d.tokens_in + d.tokens_out)) : 1

  return (
    <AppShell crumbs={[{ label: '系統管理', href: '/admin' }, { label: '用量統計' }]}>
      <div className="content">
        <div className="page-head">
          <div className="title-block">
            <h1>用量統計</h1>
            <div className="desc">
              Anthropic API token 用量與成本估算。價格基於 Sonnet：
              <code className="code">${usage?.pricing.input_per_m_usd || 3} / M 輸入</code> ·
              <code className="code">${usage?.pricing.output_per_m_usd || 15} / M 輸出</code>
            </div>
          </div>
          <div className="actions">
            <select value={days} onChange={e => setDays(Number(e.target.value))} className="text-input range">
              <option value={1}>今日</option>
              <option value={7}>近 7 天</option>
              <option value={30}>近 30 天</option>
              <option value={90}>近 90 天</option>
            </select>
            <button className="btn btn-outline" onClick={load}>
              <span className="material-symbols-outlined">refresh</span>重新整理
            </button>
          </div>
        </div>

        {usage && (
          <>
            <div className="stat-row">
              <div className="stat">
                <div className="label"><span className="material-symbols-outlined">forum</span>回應數</div>
                <div className="value">{usage.total.messages}</div>
                <div className="delta">含 query 與 ingest 對話</div>
              </div>
              <div className="stat">
                <div className="label"><span className="material-symbols-outlined">arrow_upward</span>輸入 token</div>
                <div className="value">{fmt(usage.total.tokens_in)}</div>
                <div className="delta">{usage.total.tokens_in.toLocaleString()} 個</div>
              </div>
              <div className="stat">
                <div className="label"><span className="material-symbols-outlined">arrow_downward</span>輸出 token</div>
                <div className="value">{fmt(usage.total.tokens_out)}</div>
                <div className="delta">{usage.total.tokens_out.toLocaleString()} 個</div>
              </div>
              <div className="stat cost">
                <div className="label"><span className="material-symbols-outlined">paid</span>估算成本</div>
                <div className="value">${usage.total.cost_usd.toFixed(2)}</div>
                <div className="delta">{days} 天累計</div>
              </div>
            </div>

            {queue && (
              <div className="queue-card">
                <div className="qc-title">
                  <span className="material-symbols-outlined">queue</span>
                  LLM 並發狀態（{queue.routing}）
                  <span className="qc-total">
                    總 {queue.total_in_use} / {queue.total_max_concurrent}
                    {queue.total_waiting > 0 && <span className="waiting">　排隊 {queue.total_waiting}</span>}
                  </span>
                </div>
                {(['premium', 'cheap'] as const).map(tier => {
                  const list = queue.providers.filter(p => p.tier === tier)
                  if (list.length === 0) return null
                  const tierIcon = tier === 'premium' ? 'diamond' : 'bolt'
                  const tierLabel = tier === 'premium' ? 'Premium 層（Ingest / Reflect）' : 'Cheap 層（Query / Lint）'
                  return (
                    <div key={tier} className="tier-group">
                      <div className={`tier-head tier-${tier}`}>
                        <span className="material-symbols-outlined">{tierIcon}</span>
                        <span>{tierLabel}</span>
                        <span className="tier-count">
                          {list.reduce((sum, p) => sum + p.in_use, 0)} / {list.reduce((sum, p) => sum + p.max_concurrent, 0)}
                        </span>
                      </div>
                      <div className="qc-providers">
                        {list.map(p => (
                          <div key={p.name} className="qc-prov">
                            <div className="qc-prov-head">
                              <span className={`provider-badge prov-${p.name}`}>{p.name}</span>
                              <span className="model-name">{p.model}</span>
                              {p.weight > 1 && <span className="weight-pill">×{p.weight}</span>}
                              {!p.healthy && <span className="unhealthy">⚠ 異常</span>}
                            </div>
                            <div className="qc-bars">
                              {Array.from({ length: p.max_concurrent }).map((_, i) => (
                                <span key={i} className={`slot ${i < p.in_use ? 'used' : ''}`} />
                              ))}
                            </div>
                            <div className="qc-meta">
                              <b>{p.in_use}</b> / {p.max_concurrent}
                              {p.waiting > 0 && <span className="waiting">　排隊 <b>{p.waiting}</b></span>}
                              {p.fail_count > 0 && <span className="waiting">　失敗 {p.fail_count}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            <div className="section">
              <h3>每日用量</h3>
              {usage.by_day.length === 0 ? (
                <div className="empty">這段時間沒有用量</div>
              ) : (
                <div className="bar-chart">
                  {usage.by_day.map(d => {
                    const total = d.tokens_in + d.tokens_out
                    const pct = (total / maxDayUsage) * 100
                    return (
                      <div key={d.day} className="bar-row">
                        <div className="day">{d.day?.slice(5)}</div>
                        <div className="bar-track">
                          <div className="bar in" style={{ width: `${(d.tokens_in / maxDayUsage) * 100}%` }} />
                          <div className="bar out" style={{ width: `${(d.tokens_out / maxDayUsage) * 100}%` }} />
                        </div>
                        <div className="day-val">
                          <span>{fmt(total)}</span>
                          <span className="cost">${d.cost_usd.toFixed(3)}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="section">
              <h3>按使用者 ({usage.by_user.length})</h3>
              {usage.by_user.length === 0 ? (
                <div className="empty">這段時間沒有用量</div>
              ) : (
                <table className="grid">
                  <thead>
                    <tr>
                      <th>使用者</th>
                      <th style={{ textAlign: 'right' }}>回應數</th>
                      <th style={{ textAlign: 'right' }}>輸入</th>
                      <th style={{ textAlign: 'right' }}>輸出</th>
                      <th style={{ textAlign: 'right' }}>總和</th>
                      <th style={{ textAlign: 'right' }}>成本</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.by_user.map(u => (
                      <tr key={u.username}>
                        <td className="user-cell">
                          <span className="avatar">{(u.username || '?')[0].toUpperCase()}</span>
                          <span>{u.username}</span>
                        </td>
                        <td className="num">{u.messages}</td>
                        <td className="num">{fmt(u.tokens_in)}</td>
                        <td className="num">{fmt(u.tokens_out)}</td>
                        <td className="num strong">{fmt(u.tokens_in + u.tokens_out)}</td>
                        <td className="num cost">${u.cost_usd.toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

        {loading && !usage && <div className="empty">載入中…</div>}
      </div>

      <style jsx>{`
        .content { flex: 1; overflow-y: auto; padding-bottom: 24px; }
        .page-head {
          padding: 24px 28px 0;
          display: flex; align-items: flex-end; justify-content: space-between; gap: 24px;
          flex-wrap: wrap;
        }
        .page-head h1 { margin: 0 0 4px; font-size: 24px; font-weight: 500; letter-spacing: -0.2px; }
        .page-head .desc { font-size: 13px; color: var(--text-secondary); max-width: 720px; }
        .page-head .desc :global(.code) { margin: 0 4px; }
        .actions { display: flex; gap: 8px; align-items: center; }
        .range {
          height: 36px; padding: 0 10px; border-radius: 6px;
          border: 1px solid var(--border-default); font: inherit; font-size: 13px;
        }

        .stat-row {
          padding: 20px 28px 0;
          display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;
        }
        .stat {
          border: 1px solid var(--border-default); border-radius: 8px;
          padding: 14px 16px; background: #fff;
        }
        .stat.cost { background: rgba(40,119,238,.04); border-color: rgba(40,119,238,.3); }
        .stat .label { font-size: 12px; color: var(--text-secondary); display: flex; align-items: center; gap: 6px; }
        .stat .label :global(.material-symbols-outlined) { font-size: 16px; }
        .stat .value { font-size: 26px; font-weight: 500; line-height: 1.2; margin-top: 2px; font-variant-numeric: tabular-nums; }
        .stat.cost .value { color: rgb(var(--color-sf-primary)); }
        .stat .delta { font-size: 11px; font-family: var(--font-family-mono); color: var(--text-secondary); margin-top: 2px; }

        .queue-card {
          margin: 20px 28px 0;
          padding: 16px 18px;
          border: 1px solid var(--border-default); border-radius: 8px;
          background: #fff;
        }
        .qc-title {
          display: flex; align-items: center; gap: 8px;
          font-size: 13px; font-weight: 500;
          margin-bottom: 12px;
        }
        .qc-title :global(.material-symbols-outlined) { font-size: 18px; color: var(--text-secondary); }
        .qc-total { margin-left: auto; font-size: 12px; color: var(--text-secondary); font-family: var(--font-family-mono); }
        .qc-total b { color: var(--text-primary); }
        .tier-group { margin-bottom: 14px; }
        .tier-group:last-child { margin-bottom: 0; }
        .tier-head {
          display: flex; align-items: center; gap: 6px;
          font-size: 12px; font-weight: 600;
          padding: 6px 10px; border-radius: 6px;
          margin-bottom: 8px;
          text-transform: uppercase; letter-spacing: 0.4px;
        }
        .tier-head :global(.material-symbols-outlined) { font-size: 16px; }
        .tier-head .tier-count {
          margin-left: auto;
          font-family: var(--font-family-mono);
          font-weight: 500; text-transform: none; letter-spacing: 0;
          opacity: .8;
        }
        .tier-premium { background: rgba(124,77,255,.10); color: #6a3fc4; }
        .tier-cheap   { background: rgba(108,117,125,.10); color: #5a6268; }
        .weight-pill {
          margin-left: auto;
          padding: 1px 6px; border-radius: 3px;
          font-size: 10px; font-family: var(--font-family-mono);
          background: var(--bg-surface-variant); color: var(--text-secondary);
        }
        .qc-providers { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
        .qc-prov {
          padding: 10px 12px;
          border: 1px solid var(--border-default); border-radius: 6px;
          background: rgba(40,119,238,.02);
        }
        .qc-prov-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
        .model-name { font-size: 11px; color: var(--text-secondary); font-family: var(--font-family-mono); }
        .unhealthy { margin-left: auto; font-size: 11px; color: rgb(var(--color-sf-error)); }
        .provider-badge {
          padding: 1px 6px; border-radius: 3px;
          font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px;
        }
        :global(.prov-anthropic) { background: rgba(204,108,77,.16); color: #B85C2E; }
        :global(.prov-openai)    { background: rgba(16,163,127,.16); color: #0d8e6c; }
        :global(.prov-gemini)    { background: rgba(66,133,244,.16); color: #1a73e8; }
        .qc-bars { display: flex; gap: 3px; }
        .slot {
          flex: 1; height: 20px; border-radius: 3px;
          background: var(--bg-surface-variant);
          border: 1px solid var(--border-default);
          transition: all 200ms;
        }
        .slot.used {
          background: rgb(var(--color-sf-primary));
          border-color: rgb(var(--color-sf-primary));
          animation: pulse 1.5s infinite;
        }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .6; } }
        .qc-meta { font-size: 12px; color: var(--text-secondary); font-family: var(--font-family-mono); }
        .qc-meta b { color: var(--text-primary); }
        .qc-meta .waiting { color: rgb(247,144,9); }

        .section {
          margin: 24px 28px 0;
        }
        .section h3 { font-size: 14px; font-weight: 500; margin: 0 0 12px; }

        .empty {
          padding: 32px; text-align: center; color: var(--text-secondary);
          background: var(--bg-surface-variant); border-radius: 8px;
        }

        .bar-chart { display: flex; flex-direction: column; gap: 4px; padding: 12px;
          background: #fff; border: 1px solid var(--border-default); border-radius: 8px;
        }
        .bar-row {
          display: flex; align-items: center; gap: 10px;
          font-size: 12px;
        }
        .day {
          width: 50px; font-family: var(--font-family-mono);
          color: var(--text-secondary); flex-shrink: 0;
        }
        .bar-track {
          flex: 1; height: 14px;
          background: var(--bg-surface-variant); border-radius: 3px;
          display: flex; overflow: hidden;
        }
        .bar.in { background: rgb(var(--color-sf-primary)); }
        .bar.out { background: rgb(155,89,182); }
        .day-val {
          width: 110px; text-align: right;
          font-family: var(--font-family-mono); font-size: 11.5px;
          display: flex; justify-content: flex-end; gap: 10px;
        }
        .day-val .cost { color: rgb(var(--color-sf-primary)); }

        .grid { width: 100%; border-collapse: collapse; font-size: 13px; background: #fff; border: 1px solid var(--border-default); border-radius: 8px; overflow: hidden; }
        .grid thead th {
          background: var(--bg-surface-variant);
          height: 40px; padding: 0 14px;
          text-align: left; font-weight: 500; font-size: 12.5px;
          border-bottom: 1px solid var(--border-default);
        }
        .grid tbody td {
          height: 44px; padding: 0 14px;
          border-bottom: 1px solid var(--border-default);
        }
        .grid tbody tr:last-child td { border-bottom: 0; }
        .num { font-family: var(--font-family-mono); font-variant-numeric: tabular-nums; }
        .num.strong { font-weight: 600; }
        .num.cost { color: rgb(var(--color-sf-primary)); font-weight: 500; }
        .user-cell { display: flex; align-items: center; gap: 8px; }
        .user-cell .avatar {
          width: 24px; height: 24px; border-radius: 50%;
          background: linear-gradient(135deg, rgb(var(--color-sf-primary)), rgb(var(--color-sf-on-primary-container)));
          color: #fff; display: grid; place-items: center;
          font-size: 11px; font-weight: 600;
        }
      `}</style>
    </AppShell>
  )
}
