'use client'
import { useState, useEffect, useCallback } from 'react'
import AppShell from '@/components/AppShell'
import WikiRenderer from '@/components/WikiRenderer'

interface Job {
  id: string
  type: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  progress: number
  step: string
  logs: string[]
  output: Record<string, unknown>
  error: string | null
}

interface ScanResult {
  summary: { raw_total: number; ingested_total: number; unprocessed: number; orphaned_pages: number }
  unprocessed: { name: string; path: string; size: number; mtime: number }[]
  orphaned_pages: { page: string; missing_source: string }[]
  ingested_sources: { source: string; pages: string[]; path: string | null; size: number | null }[]
}

interface PageInfo { name: string; title: string; type: string }

type Tab = 'scan' | 'reflect' | 'lint'

export default function OperationsPage() {
  const [tab, setTab] = useState<Tab>('scan')

  // Scan
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [scanLoading, setScanLoading] = useState(false)
  const [reprocessJob, setReprocessJob] = useState<Job | null>(null)
  const [reprocessing, setReprocessing] = useState<string | null>(null) // path being reprocessed

  // Reflect
  const [pages, setPages] = useState<PageInfo[]>([])
  const [reflectTopic, setReflectTopic] = useState('')
  const [reflectSources, setReflectSources] = useState<string[]>([])
  const [reflectType, setReflectType] = useState<'analysis' | 'comparison'>('analysis')
  const [reflectName, setReflectName] = useState('')
  const [reflectJob, setReflectJob] = useState<Job | null>(null)
  const [reflectStarting, setReflectStarting] = useState(false)
  const [pageFilter, setPageFilter] = useState('')

  // Lint
  const [lintJob, setLintJob] = useState<Job | null>(null)
  const [lintStarting, setLintStarting] = useState(false)

  const runScan = useCallback(async () => {
    setScanLoading(true)
    const res = await fetch('/api/admin/scan')
    if (res.ok) setScanResult(await res.json())
    setScanLoading(false)
  }, [])

  // Load page list for reflect picker
  useEffect(() => {
    fetch('/api/wiki/pages').then(r => r.ok ? r.json() : { pages: [] })
      .then(d => setPages(d.pages || []))
  }, [])

  // Auto-run scan on first load
  useEffect(() => {
    if (tab === 'scan' && !scanResult) runScan()
  }, [tab, scanResult, runScan])

  // Job polling helper
  function pollJob(job_id: string, onUpdate: (j: Job) => void) {
    const interval = setInterval(async () => {
      const res = await fetch(`/api/jobs/${job_id}`)
      if (!res.ok) return
      const j: Job = await res.json()
      onUpdate(j)
      if (j.status === 'completed' || j.status === 'failed') clearInterval(interval)
    }, 1500)
  }

  async function startReflect() {
    if (!reflectTopic.trim() || reflectSources.length === 0 || reflectStarting) return
    setReflectStarting(true)
    setReflectJob(null)
    try {
      const res = await fetch('/api/admin/reflect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: reflectTopic.trim(),
          source_pages: reflectSources,
          target_type: reflectType,
          target_name: reflectName.trim() || null,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        alert(`錯誤：${d.detail}`)
        return
      }
      const { job_id } = await res.json()
      pollJob(job_id, setReflectJob)
    } finally {
      setReflectStarting(false)
    }
  }

  async function startReprocess(path: string) {
    if (reprocessing) return
    if (!confirm(`重新 ingest ${path}？\n相同檔名的 wiki 頁面會被覆寫。`)) return
    setReprocessing(path); setReprocessJob(null)
    try {
      const res = await fetch('/api/ingest/reprocess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      })
      if (!res.ok) {
        const d = await res.json()
        alert(`錯誤：${d.detail}`)
        return
      }
      const { job_id } = await res.json()
      pollJob(job_id, j => {
        setReprocessJob(j)
        if (j.status === 'completed' || j.status === 'failed') {
          setReprocessing(null)
          if (j.status === 'completed') runScan()  // refresh scan after success
        }
      })
    } catch (e) {
      alert(`連線失敗：${e}`)
      setReprocessing(null)
    }
  }

  async function startLint() {
    if (lintStarting) return
    setLintStarting(true)
    setLintJob(null)
    try {
      const res = await fetch('/api/admin/lint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'all' }),
      })
      if (!res.ok) {
        const d = await res.json()
        alert(`錯誤：${d.detail}`)
        return
      }
      const { job_id } = await res.json()
      pollJob(job_id, setLintJob)
    } finally {
      setLintStarting(false)
    }
  }

  function toggleSource(name: string) {
    setReflectSources(s => s.includes(name) ? s.filter(x => x !== name) : [...s, name])
  }

  const filteredPages = pages.filter(p =>
    !pageFilter || p.name.toLowerCase().includes(pageFilter.toLowerCase())
                || p.title.toLowerCase().includes(pageFilter.toLowerCase()),
  )

  return (
    <AppShell crumbs={[{ label: '系統管理', href: '/admin' }, { label: '批次操作' }]}>
      <div className="content">
        <div className="page-head">
          <div className="title-block">
            <h1>批次操作</h1>
            <div className="desc">管理員專用的知識庫維運工具：掃描未處理來源、跨源合成洞察、檢查 wiki 一致性。</div>
          </div>
        </div>

        <div className="op-tabs">
          <button className={`op-tab ${tab === 'scan' ? 'active' : ''}`} onClick={() => setTab('scan')}>
            <span className="material-symbols-outlined">radar</span>
            <div>
              <div className="t">Scan</div>
              <div className="d">掃描尚未 ingest 的來源檔</div>
            </div>
          </button>
          <button className={`op-tab ${tab === 'reflect' ? 'active' : ''}`} onClick={() => setTab('reflect')}>
            <span className="material-symbols-outlined">insights</span>
            <div>
              <div className="t">Reflect</div>
              <div className="d">跨源合成 analysis / comparison 頁</div>
            </div>
          </button>
          <button className={`op-tab ${tab === 'lint' ? 'active' : ''}`} onClick={() => setTab('lint')}>
            <span className="material-symbols-outlined">rule</span>
            <div>
              <div className="t">Lint</div>
              <div className="d">檢查 wiki 一致性與品質</div>
            </div>
          </button>
        </div>

        <div className="op-body">
          {tab === 'scan' && (
            <div>
              <div className="op-actions">
                <button className="btn btn-primary" onClick={runScan} disabled={scanLoading}>
                  <span className="material-symbols-outlined">{scanLoading ? 'hourglass_top' : 'refresh'}</span>
                  {scanLoading ? '掃描中…' : '重新掃描'}
                </button>
              </div>

              {scanResult && (
                <>
                  <div className="stat-row">
                    <div className="stat">
                      <div className="label"><span className="material-symbols-outlined">folder</span>raw/ 總檔數</div>
                      <div className="value">{scanResult.summary.raw_total}</div>
                    </div>
                    <div className="stat">
                      <div className="label"><span className="material-symbols-outlined">check_circle</span>已 ingest</div>
                      <div className="value" style={{ color: 'rgb(var(--color-sf-success))' }}>{scanResult.summary.ingested_total}</div>
                    </div>
                    <div className="stat">
                      <div className="label"><span className="material-symbols-outlined">pending</span>待處理</div>
                      <div className="value" style={{ color: scanResult.summary.unprocessed > 0 ? 'rgb(247,144,9)' : undefined }}>
                        {scanResult.summary.unprocessed}
                      </div>
                    </div>
                    <div className="stat">
                      <div className="label"><span className="material-symbols-outlined">link_off</span>孤兒頁</div>
                      <div className="value" style={{ color: scanResult.summary.orphaned_pages > 0 ? 'rgb(var(--color-sf-error))' : undefined }}>
                        {scanResult.summary.orphaned_pages}
                      </div>
                    </div>
                  </div>

                  <h3 className="section-title">尚未 ingest 的來源檔（{scanResult.unprocessed.length}）</h3>
                  {scanResult.unprocessed.length === 0 ? (
                    <div className="empty">所有來源檔都已處理 ✓</div>
                  ) : (
                    <div className="file-list">
                      {scanResult.unprocessed.map(f => (
                        <div key={f.path} className="file-item">
                          <span className="material-symbols-outlined">description</span>
                          <div className="file-info">
                            <div className="name">{f.name}</div>
                            <div className="path">{f.path} · {(f.size / 1024).toFixed(0)} KB</div>
                          </div>
                          <a href="/ingest" className="btn btn-outline sm">
                            <span className="material-symbols-outlined">upload_file</span>
                            前往 Ingest
                          </a>
                        </div>
                      ))}
                    </div>
                  )}

                  {scanResult.orphaned_pages.length > 0 && (
                    <>
                      <h3 className="section-title danger">引用了不存在來源的頁面（{scanResult.orphaned_pages.length}）</h3>
                      <div className="file-list">
                        {scanResult.orphaned_pages.map((o, i) => (
                          <div key={i} className="file-item">
                            <span className="material-symbols-outlined" style={{ color: 'rgb(var(--color-sf-error))' }}>warning</span>
                            <div className="file-info">
                              <div className="name">[[{o.page}]]</div>
                              <div className="path">缺少來源：<code>{o.missing_source}</code></div>
                            </div>
                            <a href={`/browse/${o.page}`} className="btn btn-outline sm">查看頁面</a>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {/* Re-ingest section: all already-ingested files */}
                  {scanResult.ingested_sources.filter(s => s.path).length > 0 && (
                    <>
                      <h3 className="section-title">已 ingest 的來源（可重新處理 {scanResult.ingested_sources.filter(s => s.path).length}）</h3>
                      <div className="file-list">
                        {scanResult.ingested_sources.filter(s => s.path).map(s => (
                          <div key={s.source} className="file-item">
                            <span className="material-symbols-outlined">task_alt</span>
                            <div className="file-info">
                              <div className="name">{s.source}</div>
                              <div className="path">
                                {s.path} · {s.size ? `${(s.size / 1024).toFixed(0)} KB` : '—'}
                                {' · '}已建立 {s.pages.length} 頁：{s.pages.slice(0, 3).join(', ')}{s.pages.length > 3 ? `… +${s.pages.length - 3}` : ''}
                              </div>
                            </div>
                            <button
                              className="btn btn-outline sm"
                              onClick={() => s.path && startReprocess(s.path)}
                              disabled={!!reprocessing}
                              title="重新 ingest（會覆寫相同檔名的 wiki 頁）"
                            >
                              <span className="material-symbols-outlined">refresh</span>
                              {reprocessing === s.path ? '處理中…' : '重新 ingest'}
                            </button>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {reprocessJob && <JobCard job={reprocessJob} />}
                </>
              )}
            </div>
          )}

          {tab === 'reflect' && (
            <div>
              <div className="reflect-form">
                <div className="field-row">
                  <label>主題 *</label>
                  <input value={reflectTopic} onChange={e => setReflectTopic(e.target.value)}
                    placeholder="例如：四間飯店轉移時程影響因子"
                    className="text-input" />
                </div>

                <div className="field-row">
                  <label>目標類型 *</label>
                  <div className="radio-group">
                    <label className={`radio ${reflectType === 'analysis' ? 'active' : ''}`}>
                      <input type="radio" name="rtype" checked={reflectType === 'analysis'}
                        onChange={() => setReflectType('analysis')} />
                      <span className="material-symbols-outlined">insights</span>
                      <div>
                        <div className="t">analysis_*</div>
                        <div className="d">隱性洞察 / 經驗法則</div>
                      </div>
                    </label>
                    <label className={`radio ${reflectType === 'comparison' ? 'active' : ''}`}>
                      <input type="radio" name="rtype" checked={reflectType === 'comparison'}
                        onChange={() => setReflectType('comparison')} />
                      <span className="material-symbols-outlined">compare_arrows</span>
                      <div>
                        <div className="t">comparison_*</div>
                        <div className="d">並列對照 + 結論</div>
                      </div>
                    </label>
                  </div>
                </div>

                <div className="field-row">
                  <label>建議檔名（選填）</label>
                  <input value={reflectName} onChange={e => setReflectName(e.target.value)}
                    placeholder={`${reflectType}_主題`}
                    className="text-input" />
                  <div className="hint">留空時 Claude 會自動命名</div>
                </div>

                <div className="field-row">
                  <label>來源頁面 *（已選 {reflectSources.length}）</label>
                  <div className="picker">
                    <input value={pageFilter} onChange={e => setPageFilter(e.target.value)}
                      placeholder="搜尋頁面…"
                      className="text-input picker-search" />
                    <div className="picker-list">
                      {filteredPages.slice(0, 100).map(p => (
                        <label key={p.name} className={`picker-item ${reflectSources.includes(p.name) ? 'active' : ''}`}>
                          <input type="checkbox" checked={reflectSources.includes(p.name)}
                            onChange={() => toggleSource(p.name)} />
                          <span className={`type-chip type-${p.type}`}>{p.type}</span>
                          <span className="picker-title">{p.title}</span>
                          <span className="picker-name">{p.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                <button className="btn btn-primary lg" onClick={startReflect}
                  disabled={!reflectTopic.trim() || reflectSources.length === 0 || reflectStarting}>
                  <span className="material-symbols-outlined">play_arrow</span>
                  {reflectStarting ? '啟動中…' : `開始 Reflect（${reflectSources.length} 個來源）`}
                </button>
              </div>

              {reflectJob && <JobCard job={reflectJob} />}
            </div>
          )}

          {tab === 'lint' && (
            <div>
              <div className="lint-intro">
                <p>Lint 將自動檢查整個 wiki：</p>
                <ul>
                  <li>壞掉的 <code>[[wiki link]]</code></li>
                  <li>缺漏的 frontmatter 欄位</li>
                  <li>命名與 type 不一致</li>
                  <li>孤兒頁面</li>
                  <li>內容矛盾（Claude 抽樣檢查）</li>
                </ul>
                <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                  Lint 是<b>唯讀操作</b>，絕不會修改任何頁面。
                </p>
              </div>

              <button className="btn btn-primary lg" onClick={startLint} disabled={lintStarting}>
                <span className="material-symbols-outlined">{lintStarting ? 'hourglass_top' : 'rule'}</span>
                {lintStarting ? '啟動中…' : '開始 Lint'}
              </button>

              {lintJob && (
                <>
                  <JobCard job={lintJob} />
                  {lintJob.status === 'completed' && (lintJob.output as { report_markdown?: string })?.report_markdown && (
                    <div className="lint-report">
                      <div className="report-head">
                        <span className="material-symbols-outlined">description</span>
                        Lint 報告
                      </div>
                      <div className="report-body wiki-body">
                        <WikiRenderer content={(lintJob.output as { report_markdown: string }).report_markdown} />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .content { flex: 1; overflow-y: auto; padding-bottom: 24px; }
        .page-head { padding: 24px 28px 0; }
        .page-head h1 { margin: 0 0 4px; font-size: 24px; font-weight: 500; letter-spacing: -0.2px; }
        .page-head .desc { font-size: 13px; color: var(--text-secondary); max-width: 720px; }

        .op-tabs {
          display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;
          padding: 24px 28px 0;
        }
        .op-tab {
          display: flex; align-items: center; gap: 14px;
          padding: 16px 18px;
          border: 1px solid var(--border-default); border-radius: 12px;
          background: #fff; cursor: pointer; text-align: left;
          font: inherit; transition: all 120ms;
        }
        .op-tab:hover { border-color: rgba(40,119,238,.5); }
        .op-tab.active {
          border-color: rgb(var(--color-sf-primary));
          background: rgba(40,119,238,.04);
        }
        .op-tab :global(.material-symbols-outlined) {
          font-size: 28px; color: var(--text-secondary);
          flex-shrink: 0;
        }
        .op-tab.active :global(.material-symbols-outlined) {
          color: rgb(var(--color-sf-primary));
          font-variation-settings: 'FILL' 1;
        }
        .op-tab .t { font-size: 15px; font-weight: 500; }
        .op-tab .d { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }

        .op-body { padding: 24px 28px; }
        .op-actions { display: flex; gap: 8px; margin-bottom: 16px; }

        .stat-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
        .stat {
          border: 1px solid var(--border-default); border-radius: 8px;
          padding: 14px 16px; background: #fff;
        }
        .stat .label { font-size: 12px; color: var(--text-secondary); display: flex; align-items: center; gap: 6px; }
        .stat .label :global(.material-symbols-outlined) { font-size: 16px; }
        .stat .value { font-size: 26px; font-weight: 500; line-height: 1.2; margin-top: 2px; font-variant-numeric: tabular-nums; }

        .section-title {
          font-size: 14px; font-weight: 500; margin: 24px 0 12px;
          padding-bottom: 8px; border-bottom: 1px solid var(--border-default);
        }
        .section-title.danger { color: rgb(var(--color-sf-error)); }

        .empty {
          padding: 32px; text-align: center;
          color: rgb(var(--color-sf-success));
          background: rgba(18,183,106,.06); border-radius: 8px; font-size: 14px;
        }

        .file-list { display: flex; flex-direction: column; gap: 6px; }
        .file-item {
          display: flex; align-items: center; gap: 12px;
          padding: 10px 14px; border: 1px solid var(--border-default); border-radius: 8px;
          background: #fff;
        }
        .file-item :global(.material-symbols-outlined) { font-size: 20px; color: var(--text-secondary); flex-shrink: 0; }
        .file-info { flex: 1; min-width: 0; }
        .file-info .name { font-weight: 500; font-size: 14px; }
        .file-info .path {
          font-size: 11.5px; color: var(--text-secondary);
          font-family: var(--font-family-mono);
          margin-top: 2px;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }

        .reflect-form { display: flex; flex-direction: column; gap: 16px; }
        .field-row { display: flex; flex-direction: column; gap: 6px; }
        .field-row label { font-size: 13px; font-weight: 500; }
        .hint { font-size: 11.5px; color: var(--text-secondary); }
        .text-input {
          height: 40px; padding: 0 12px;
          border: 1px solid var(--border-default); border-radius: 8px;
          font: inherit; font-size: 14px; outline: none;
          transition: border-color 120ms;
        }
        .text-input:focus {
          border-color: rgb(var(--color-sf-primary));
          box-shadow: 0 0 0 4px rgba(40,119,238,.16);
        }

        .radio-group { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .radio {
          display: flex; align-items: center; gap: 12px;
          padding: 12px 14px; border: 1px solid var(--border-default); border-radius: 8px;
          cursor: pointer; transition: all 120ms;
        }
        .radio:hover { border-color: rgba(40,119,238,.5); }
        .radio.active {
          border-color: rgb(var(--color-sf-primary));
          background: rgba(40,119,238,.04);
        }
        .radio input { display: none; }
        .radio :global(.material-symbols-outlined) { font-size: 22px; color: var(--text-secondary); }
        .radio.active :global(.material-symbols-outlined) { color: rgb(var(--color-sf-primary)); }
        .radio .t { font-size: 14px; font-weight: 500; font-family: var(--font-family-mono); }
        .radio .d { font-size: 11.5px; color: var(--text-secondary); margin-top: 2px; }

        .picker { border: 1px solid var(--border-default); border-radius: 8px; overflow: hidden; }
        .picker-search { border: 0; border-bottom: 1px solid var(--border-default); border-radius: 0; height: 36px; }
        .picker-search:focus { box-shadow: none; border-color: var(--border-default); border-bottom-color: rgb(var(--color-sf-primary)); }
        .picker-list { max-height: 280px; overflow-y: auto; }
        .picker-item {
          display: flex; align-items: center; gap: 8px;
          padding: 6px 12px; cursor: pointer;
          border-bottom: 1px solid var(--border-default);
          font-size: 13px; transition: background 120ms;
        }
        .picker-item:hover { background: rgba(40,119,238,.04); }
        .picker-item.active { background: rgba(40,119,238,.08); }
        .picker-item:last-child { border-bottom: 0; }
        .picker-item input { margin: 0; }
        .picker-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .picker-name { font-size: 11px; color: var(--text-secondary); font-family: var(--font-family-mono); }

        .type-chip {
          display: inline-flex; padding: 1px 6px; border-radius: 3px;
          font-size: 10px; font-weight: 500;
          font-family: var(--font-family-mono); flex-shrink: 0;
        }
        :global(.type-source) { background: rgba(46,144,250,.14); color: #1570CD; }
        :global(.type-entity) { background: rgba(155,89,182,.14); color: #7B3FA8; }
        :global(.type-concept) { background: rgba(18,183,106,.14); color: rgb(var(--color-sf-success)); }
        :global(.type-comparison) { background: rgba(247,144,9,.14); color: #B96A02; }
        :global(.type-analysis) { background: rgba(244,73,62,.14); color: rgb(var(--color-sf-danger)); }
        :global(.type-special), :global(.type-other) { background: var(--bg-surface-variant); color: var(--text-secondary); }

        .lint-intro {
          background: rgba(40,119,238,.04);
          border: 1px solid rgba(40,119,238,.2);
          border-radius: 8px; padding: 16px 20px;
          font-size: 13.5px; line-height: 1.7;
          margin-bottom: 16px;
        }
        .lint-intro p { margin: 0 0 8px; }
        .lint-intro ul { margin: 8px 0 12px; padding-left: 24px; }
        .lint-intro code { font-family: var(--font-family-mono); background: #fff; padding: 2px 6px; border-radius: 3px; font-size: 12px; }

        .lint-report {
          margin-top: 24px; border: 1px solid var(--border-default);
          border-radius: 12px; overflow: hidden;
        }
        .report-head {
          display: flex; align-items: center; gap: 8px;
          padding: 12px 18px; background: var(--bg-surface-variant);
          font-weight: 500; font-size: 14px;
          border-bottom: 1px solid var(--border-default);
        }
        .report-body { padding: 20px 24px; line-height: 1.7; }
      `}</style>
    </AppShell>
  )
}

function JobCard({ job }: { job: Job }) {
  return (
    <div className="job-card">
      <div className="job-head">
        <div className="job-status">
          <span className={`status-dot ${job.status}`} />
          <span style={{ fontWeight: 500, fontSize: 14 }}>{job.step}</span>
        </div>
        <span style={{ fontSize: 12, fontFamily: 'var(--font-family-mono)', color: 'var(--text-secondary)' }}>
          {Math.round(job.progress * 100)}%
        </span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${job.progress * 100}%` }} />
      </div>
      {job.logs.length > 0 && (
        <div className="logs">
          {job.logs.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
      {job.status === 'completed' && (job.output as { pages_created?: string[] }).pages_created && (
        <div className="result success">
          <p style={{ margin: 0, fontWeight: 500, fontSize: 13, color: 'rgb(var(--color-sf-success))', marginBottom: 8 }}>
            ✓ 成功建立 {(job.output as { pages_created: string[] }).pages_created.length} 個頁面
          </p>
          <div className="page-chips">
            {(job.output as { pages_created: string[] }).pages_created.map(p => (
              <a key={p} href={`/browse/${p}`} className="page-chip">
                <span className="material-symbols-outlined">open_in_new</span>{p}
              </a>
            ))}
          </div>
        </div>
      )}
      {job.status === 'failed' && (
        <div className="result error">
          <span className="material-symbols-outlined">error</span>{job.error}
        </div>
      )}

      <style jsx>{`
        .job-card {
          margin-top: 20px;
          border: 1px solid var(--border-default);
          border-radius: 12px; overflow: hidden; background: #fff;
        }
        .job-head {
          padding: 14px 18px;
          display: flex; justify-content: space-between; align-items: center;
          border-bottom: 1px solid var(--border-default);
        }
        .job-status { display: flex; align-items: center; gap: 8px; }
        .status-dot { width: 8px; height: 8px; border-radius: 50%; }
        .status-dot.queued, .status-dot.running {
          background: rgb(var(--color-sf-primary)); animation: pulse 1.5s infinite;
        }
        .status-dot.completed { background: rgb(var(--color-sf-success)); }
        .status-dot.failed { background: rgb(var(--color-sf-error)); }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }

        .progress-track { height: 4px; background: var(--bg-surface-variant); }
        .progress-fill { height: 100%; background: rgb(var(--color-sf-primary)); transition: width 500ms; }

        .logs {
          padding: 12px 18px; background: var(--bg-surface-variant);
          font-family: var(--font-family-mono); font-size: 11.5px;
          color: var(--text-secondary); line-height: 1.7;
          max-height: 200px; overflow-y: auto;
          border-bottom: 1px solid var(--border-default);
        }

        .result { padding: 16px 18px; }
        .result.error {
          color: rgb(var(--color-sf-error)); font-size: 13px;
          display: flex; align-items: center; gap: 8px;
        }
        .result.error :global(.material-symbols-outlined) { font-size: 18px; }

        .page-chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .page-chip {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 4px 12px; border-radius: 999px;
          background: rgb(var(--color-sf-primary-container));
          color: rgb(var(--color-sf-on-primary-container));
          font-size: 12px; font-weight: 500;
          text-decoration: none;
        }
        .page-chip :global(.material-symbols-outlined) { font-size: 13px; }
      `}</style>
    </div>
  )
}
