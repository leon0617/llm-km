'use client'
import { useState, useEffect, ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import WikiRenderer from './WikiRenderer'

interface Props {
  name: string
  initialMarkdown: string  // full markdown with frontmatter
  children: ReactNode      // static rendering (used in view mode)
}

interface MeResponse { role: string }

export function PageActionButtons({ name, onEditClick }: { name: string; onEditClick: () => void }) {
  const router = useRouter()
  const [role, setRole] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null)
      .then((d: MeResponse | null) => d && setRole(d.role))
  }, [])

  const canEdit = role === 'admin' || role === 'editor'
  const canDelete = role === 'admin'
  const isProtected = name === 'index' || name === 'log'

  async function remove() {
    if (!confirm(`確定要刪除頁面 [[${name}]]？此操作無法復原。`)) return
    const res = await fetch(`/api/wiki/page/${encodeURIComponent(name)}`, { method: 'DELETE' })
    if (res.ok) {
      router.push('/browse')
    } else {
      const d = await res.json()
      alert(d.detail || '刪除失敗')
    }
  }

  if (!canEdit) return null

  return (
    <div className="page-actions">
      <button className="btn-icon-text" onClick={onEditClick} title="編輯此頁面">
        <span className="material-symbols-outlined">edit</span>
        編輯
      </button>
      {canDelete && !isProtected && (
        <button className="btn-icon-text danger" onClick={remove} title="刪除此頁面">
          <span className="material-symbols-outlined">delete</span>
          刪除
        </button>
      )}

      <style jsx>{`
        .page-actions { display: flex; gap: 6px; align-items: center; }
        .btn-icon-text {
          display: inline-flex; align-items: center; gap: 4px;
          height: 32px; padding: 0 12px; border-radius: 6px;
          border: 1px solid var(--border-default); background: #fff;
          font: inherit; font-size: 13px; color: var(--text-primary);
          cursor: pointer; transition: all 120ms;
        }
        .btn-icon-text:hover:not(:disabled) {
          border-color: rgb(var(--color-sf-primary));
          color: rgb(var(--color-sf-primary));
        }
        .btn-icon-text :global(.material-symbols-outlined) { font-size: 16px; }
        .btn-icon-text.danger:hover {
          border-color: rgb(var(--color-sf-error));
          color: rgb(var(--color-sf-error));
        }
      `}</style>
    </div>
  )
}

export default function WikiPageActions({ name, initialMarkdown, children }: Props) {
  const router = useRouter()
  const [role, setRole] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [content, setContent] = useState(initialMarkdown)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showPreview, setShowPreview] = useState(false)

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null)
      .then((d: MeResponse | null) => d && setRole(d.role))
  }, [])

  const canEdit = role === 'admin' || role === 'editor'
  const canDelete = role === 'admin'
  const isProtected = name === 'index' || name === 'log'

  async function save() {
    if (saving) return
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/wiki/page/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (!res.ok) {
        const d = await res.json()
        setError(d.detail || '儲存失敗')
        return
      }
      setEditing(false)
      router.refresh()
    } catch (e) {
      setError(`連線失敗：${e}`)
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!confirm(`確定要刪除頁面 [[${name}]]？此操作無法復原。`)) return
    const res = await fetch(`/api/wiki/page/${encodeURIComponent(name)}`, { method: 'DELETE' })
    if (res.ok) {
      router.push('/browse')
    } else {
      const d = await res.json()
      alert(d.detail || '刪除失敗')
    }
  }

  if (!editing) {
    return (
      <>
        {canEdit && (
          <div className="action-bar">
            <button className="btn-icon-text" onClick={() => setEditing(true)}>
              <span className="material-symbols-outlined">edit</span>
              編輯
            </button>
            {canDelete && !isProtected && (
              <button className="btn-icon-text danger" onClick={remove}>
                <span className="material-symbols-outlined">delete</span>
                刪除
              </button>
            )}
          </div>
        )}
        {children}

        <style jsx>{`
          .action-bar {
            display: flex; gap: 6px; justify-content: flex-end;
            padding: 12px 28px 0;
          }
          .btn-icon-text {
            display: inline-flex; align-items: center; gap: 4px;
            height: 32px; padding: 0 12px; border-radius: 6px;
            border: 1px solid var(--border-default); background: #fff;
            font: inherit; font-size: 13px; color: var(--text-primary);
            cursor: pointer; transition: all 120ms;
          }
          .btn-icon-text:hover {
            border-color: rgb(var(--color-sf-primary));
            color: rgb(var(--color-sf-primary));
          }
          .btn-icon-text :global(.material-symbols-outlined) { font-size: 16px; }
          .btn-icon-text.danger:hover {
            border-color: rgb(var(--color-sf-error));
            color: rgb(var(--color-sf-error));
          }
        `}</style>
      </>
    )
  }

  return (
    <div className="edit-container">
      <div className="edit-toolbar">
        <div className="edit-status">
          <span className="material-symbols-outlined" style={{ color: 'rgb(247,144,9)' }}>edit_note</span>
          編輯模式 · <span className="filename">{name}.md</span> · {content.length} 字
        </div>
        <div className="edit-actions">
          <button className="btn-icon-text" onClick={() => setShowPreview(p => !p)}>
            <span className="material-symbols-outlined">{showPreview ? 'edit' : 'visibility'}</span>
            {showPreview ? '回到編輯' : '預覽'}
          </button>
          <button className="btn-icon-text" onClick={() => { setEditing(false); setContent(initialMarkdown); setError('') }}
            disabled={saving}>
            <span className="material-symbols-outlined">close</span>
            取消
          </button>
          <button className="btn-icon-text primary" onClick={save} disabled={saving}>
            <span className="material-symbols-outlined">{saving ? 'hourglass_top' : 'save'}</span>
            {saving ? '儲存中…' : '儲存'}
          </button>
        </div>
      </div>

      {error && (
        <div className="edit-error">
          <span className="material-symbols-outlined">error</span>{error}
        </div>
      )}

      {showPreview ? (
        <div className="edit-preview">
          <div className="wiki-body">
            <WikiRenderer content={extractBody(content)} />
          </div>
        </div>
      ) : (
        <textarea
          className="edit-textarea"
          value={content}
          onChange={e => setContent(e.target.value)}
          spellCheck={false}
          autoFocus
        />
      )}

      <div className="edit-hint">
        <span className="material-symbols-outlined">info</span>
        支援 Obsidian 語法：<code>[[頁名]]</code>、<code>![[圖名.png]]</code>、頂部 YAML frontmatter（title/type/tags）
      </div>

      <style jsx>{`
        .edit-container {
          display: flex; flex-direction: column; gap: 12px;
          padding: 16px 28px 24px;
        }
        .edit-toolbar {
          display: flex; align-items: center; justify-content: space-between;
          padding: 10px 14px; background: rgba(247,144,9,.08);
          border: 1px solid rgba(247,144,9,.3); border-radius: 8px;
        }
        .edit-status {
          display: flex; align-items: center; gap: 8px;
          font-size: 13px; font-weight: 500;
        }
        .edit-status :global(.material-symbols-outlined) { font-size: 18px; }
        .filename { font-family: var(--font-family-mono); font-size: 12px; color: var(--text-secondary); }
        .edit-actions { display: flex; gap: 6px; }

        .btn-icon-text {
          display: inline-flex; align-items: center; gap: 4px;
          height: 32px; padding: 0 12px; border-radius: 6px;
          border: 1px solid var(--border-default); background: #fff;
          font: inherit; font-size: 13px; color: var(--text-primary);
          cursor: pointer; transition: all 120ms;
        }
        .btn-icon-text:hover:not(:disabled) {
          border-color: rgb(var(--color-sf-primary));
          color: rgb(var(--color-sf-primary));
        }
        .btn-icon-text:disabled { opacity: .5; cursor: not-allowed; }
        .btn-icon-text :global(.material-symbols-outlined) { font-size: 16px; }
        .btn-icon-text.primary {
          background: rgb(var(--color-sf-primary)); color: #fff;
          border-color: rgb(var(--color-sf-primary));
        }
        .btn-icon-text.primary:hover:not(:disabled) {
          background: rgb(31,87,209); color: #fff;
        }

        .edit-error {
          display: flex; align-items: center; gap: 8px;
          padding: 10px 14px;
          background: rgb(var(--color-sf-error-container));
          color: rgb(var(--color-sf-on-error-container));
          border-radius: 6px; font-size: 13px;
        }
        .edit-error :global(.material-symbols-outlined) { font-size: 16px; }

        .edit-textarea {
          width: 100%; min-height: 60vh;
          padding: 16px;
          border: 1px solid var(--border-default); border-radius: 8px;
          font-family: var(--font-family-mono); font-size: 13.5px; line-height: 1.6;
          color: var(--text-primary); background: #fff;
          outline: none; resize: vertical;
        }
        .edit-textarea:focus {
          border-color: rgb(var(--color-sf-primary));
          box-shadow: 0 0 0 4px rgba(40,119,238,.16);
        }
        .edit-preview {
          min-height: 60vh; padding: 20px;
          border: 1px solid var(--border-default); border-radius: 8px;
          background: #fff;
        }

        .edit-hint {
          display: flex; align-items: center; gap: 6px;
          font-size: 12px; color: var(--text-secondary);
        }
        .edit-hint :global(.material-symbols-outlined) { font-size: 14px; }
        .edit-hint :global(code) {
          font-family: var(--font-family-mono); font-size: 11.5px;
          background: var(--bg-surface-variant); padding: 1px 5px; border-radius: 3px;
          margin: 0 2px;
        }
      `}</style>
    </div>
  )
}

function extractBody(full: string): string {
  if (!full.startsWith('---')) return full
  const end = full.indexOf('\n---', 3)
  if (end === -1) return full
  return full.slice(end + 4).trimStart()
}
