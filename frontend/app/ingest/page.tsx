'use client'
import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import AppShell from '@/components/AppShell'

interface Job {
  id: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  progress: number
  step: string
  logs: string[]
  output: { pages_created?: string[]; png_files?: string[] }
  error: string | null
}

const ALLOWED = [
  '.pdf', '.txt', '.md',
  '.docx', '.xlsx', '.pptx',
  '.doc', '.xls', '.ppt',
  '.odt', '.ods', '.odp',
  '.rtf',
]
const ACCEPT_ATTR = ALLOWED.join(',')

export default function IngestPage() {
  const router = useRouter()
  const [role, setRole] = useState<string | null>(null)
  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(d => {
      if (!d) { router.push('/login'); return }
      if (d.role !== 'admin' && d.role !== 'editor') {
        router.replace('/query')
        return
      }
      setRole(d.role)
    })
  }, [router])

  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [note, setNote] = useState('')
  const [job, setJob] = useState<Job | null>(null)
  const [uploading, setUploading] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval>>()

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) setFile(f)
  }

  async function submit() {
    if (!file || uploading) return
    setUploading(true); setJob(null)
    const fd = new FormData()
    fd.append('file', file); fd.append('note', note)
    try {
      const res = await fetch('/api/ingest', { method: 'POST', body: fd })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || '上傳失敗')
      }
      const { job_id } = await res.json()
      pollJob(job_id)
    } catch (err) {
      alert(`錯誤：${err}`)
    } finally {
      setUploading(false)
    }
  }

  function pollJob(job_id: string) {
    clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      const res = await fetch(`/api/jobs/${job_id}`)
      if (!res.ok) return
      const j: Job = await res.json()
      setJob(j)
      if (j.status === 'completed' || j.status === 'failed') clearInterval(pollRef.current)
    }, 1500)
  }

  useEffect(() => () => clearInterval(pollRef.current), [])

  const ext = file ? '.' + file.name.split('.').pop()!.toLowerCase() : ''
  const validFile = file && ALLOWED.includes(ext)

  return (
    <AppShell crumbs={[{ label: '文件上傳' }]}>
      <div className="content">
        <div className="page-head">
          <div className="title-block">
            <h1>文件上傳</h1>
            <div className="desc">上傳 PDF、Word、Excel、PowerPoint、TXT 或 MD 文件，Claude 將自動整理成 wiki 頁面，並交叉引用既有知識。Office 檔會自動轉 PDF 保留圖文。</div>
          </div>
        </div>

        <div className="form-stage">
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`drop-zone ${dragging ? 'dragging' : ''}`}
            onClick={() => document.getElementById('fileInput')!.click()}
          >
            <input id="fileInput" type="file" accept={ACCEPT_ATTR} style={{ display: 'none' }}
              onChange={e => setFile(e.target.files?.[0] || null)} />
            <span className="material-symbols-outlined ic">upload_file</span>
            {file ? (
              <div>
                <p className="fname">{file.name}</p>
                <p className="fsize">{(file.size / 1024).toFixed(0)} KB</p>
                {!validFile && <p className="fwarn">不支援的格式，請上傳 PDF / Word / Excel / PPT / TXT / MD</p>}
              </div>
            ) : (
              <div>
                <p className="fname">拖放檔案到這裡，或點擊選擇</p>
                <p className="fsize">支援 PDF、Word、Excel、PowerPoint、TXT、MD，最大 50MB</p>
              </div>
            )}
          </div>

          <div className="field-row">
            <label>備註（選填）</label>
            <input value={note} onChange={e => setNote(e.target.value)}
              placeholder="例如：2026 Q2 版本的硬體規格"
              className="text-input" />
          </div>

          <button onClick={submit} disabled={!validFile || uploading || (!!job && job.status !== 'completed' && job.status !== 'failed')}
            className="btn btn-primary lg" style={{ width: '100%', justifyContent: 'center' }}>
            {uploading ? (
              <>
                <span className="spinner" />上傳中…
              </>
            ) : (
              <>
                <span className="material-symbols-outlined">rocket_launch</span>
                開始 Ingest
              </>
            )}
          </button>

          {job && (
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

              {job.status === 'completed' && (
                <div className="result success">
                  <p style={{ margin: 0, fontWeight: 500, fontSize: 13, color: 'rgb(var(--color-sf-success))', marginBottom: job.output.pages_created?.length || job.output.png_files?.length ? 10 : 0 }}>
                    ✓ 成功建立 {job.output.pages_created?.length ?? 0} 個頁面
                  </p>
                  {(job.output.pages_created?.length ?? 0) > 0 && (
                    <div className="page-chips" style={{ marginBottom: 10 }}>
                      {job.output.pages_created!.map(p => (
                        <a key={p} href={`/browse/${p}`} className="page-chip">
                          <span className="material-symbols-outlined">open_in_new</span>
                          {p}
                        </a>
                      ))}
                    </div>
                  )}
                  {(job.output.png_files?.length ?? 0) > 0 && (
                    <div className="files-section">
                      <p className="files-label">
                        <span className="material-symbols-outlined">image</span>
                        轉換圖檔（{job.output.png_files!.length} 頁）
                      </p>
                      <div className="file-chips">
                        {job.output.png_files!.map(f => (
                          <a key={f} href={`/api/raw/assets/${f}`} className="file-chip" target="_blank" rel="noopener noreferrer">
                            <span className="material-symbols-outlined">download</span>
                            {f}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {job.status === 'failed' && (
                <div className="result error">
                  <span className="material-symbols-outlined">error</span>
                  {job.error}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .content { flex: 1; overflow-y: auto; padding: 0 0 32px; }
        .page-head { padding: 24px 28px 0; }
        .page-head h1 { margin: 0 0 4px; font-size: 24px; font-weight: 500; letter-spacing: -0.2px; }
        .page-head .desc { font-size: 13px; color: var(--text-secondary); max-width: 640px; }

        .form-stage {
          max-width: 640px; margin: 24px auto 0; padding: 0 28px;
          display: flex; flex-direction: column; gap: 16px;
        }

        .drop-zone {
          border: 2px dashed var(--border-default);
          border-radius: 12px;
          padding: 48px 24px; text-align: center;
          cursor: pointer; transition: all 150ms;
          background: #fff;
        }
        .drop-zone:hover { border-color: rgba(40,119,238,.5); background: rgba(40,119,238,.02); }
        .drop-zone.dragging { border-color: rgb(var(--color-sf-primary)); background: rgba(40,119,238,.04); }
        .drop-zone .ic {
          font-size: 48px; color: var(--border-strong);
          display: block; margin-bottom: 12px;
        }
        .drop-zone .fname { font-weight: 500; color: var(--text-primary); margin: 0; font-size: 14.5px; }
        .drop-zone .fsize { font-size: 13px; color: var(--text-secondary); margin: 4px 0 0; }
        .drop-zone .fwarn { font-size: 13px; color: rgb(var(--color-sf-error)); margin: 4px 0 0; }

        .field-row { display: flex; flex-direction: column; gap: 6px; }
        .field-row label { font-size: 13px; font-weight: 500; }
        .text-input {
          height: 40px; padding: 0 12px;
          border: 1px solid var(--border-default);
          border-radius: 8px;
          font-family: inherit; font-size: 14px;
          outline: none; transition: border-color 120ms, box-shadow 120ms;
        }
        .text-input:focus {
          border-color: rgb(var(--color-sf-primary));
          box-shadow: 0 0 0 4px rgba(40,119,238,.16);
        }

        .spinner {
          width: 16px; height: 16px;
          border: 2px solid rgba(255,255,255,.4);
          border-top-color: #fff; border-radius: 50%;
          animation: spin 700ms linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        .job-card {
          margin-top: 8px;
          border: 1px solid var(--border-default);
          border-radius: 12px;
          overflow: hidden;
          background: #fff;
        }
        .job-head {
          padding: 14px 18px;
          display: flex; align-items: center; justify-content: space-between;
          border-bottom: 1px solid var(--border-default);
        }
        .job-status { display: flex; align-items: center; gap: 8px; }
        .status-dot {
          width: 8px; height: 8px; border-radius: 50%;
        }
        .status-dot.queued, .status-dot.running {
          background: rgb(var(--color-sf-primary));
          animation: pulse 1.5s ease-in-out infinite;
        }
        .status-dot.completed { background: rgb(var(--color-sf-success)); }
        .status-dot.failed { background: rgb(var(--color-sf-error)); }
        @keyframes pulse {
          0%,100% { opacity: 1; }
          50% { opacity: 0.4; }
        }

        .progress-track { height: 4px; background: var(--bg-surface-variant); }
        .progress-fill {
          height: 100%; background: rgb(var(--color-sf-primary));
          transition: width 500ms ease-out;
        }

        .logs {
          padding: 12px 18px;
          background: var(--bg-surface-variant);
          font-family: var(--font-family-mono);
          font-size: 11.5px; color: var(--text-secondary);
          line-height: 1.7; max-height: 160px; overflow-y: auto;
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
          text-decoration: none; transition: opacity 120ms;
        }
        .page-chip:hover { opacity: 0.8; }
        .page-chip :global(.material-symbols-outlined) { font-size: 13px; }

        .files-section { margin-top: 4px; }
        .files-label {
          display: flex; align-items: center; gap: 5px;
          font-size: 12px; font-weight: 500; color: var(--text-secondary);
          margin: 0 0 6px;
        }
        .files-label :global(.material-symbols-outlined) { font-size: 14px; }
        .file-chips { display: flex; flex-wrap: wrap; gap: 4px; }
        .file-chip {
          display: inline-flex; align-items: center; gap: 3px;
          padding: 3px 8px; border-radius: 4px;
          background: var(--bg-surface-variant);
          border: 1px solid var(--border-default);
          color: var(--text-secondary);
          font-size: 11px; font-family: var(--font-family-mono);
          text-decoration: none; transition: background 120ms;
        }
        .file-chip:hover { background: var(--border-default); color: var(--text-primary); }
        .file-chip :global(.material-symbols-outlined) { font-size: 11px; }
      `}</style>
    </AppShell>
  )
}
