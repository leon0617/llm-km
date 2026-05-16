'use client'
import { useState, useEffect, useCallback } from 'react'
import AppShell from '@/components/AppShell'

interface User {
  username: string
  display_name: string
  role: string
  active: boolean
  must_change_password?: boolean
  last_login_at?: string | null
  created_at?: string
  auth_source?: 'local' | 'ad'
  employee_id?: string
  email?: string
}

const ROLE_LABELS: Record<string, string> = {
  admin: '管理員',
  editor: '編輯者',
  user: '一般使用者',
}
const ROLE_COLORS: Record<string, string> = {
  admin: 'type-source',     // blue
  editor: 'type-comparison', // orange
  user: 'type-concept',     // green
}
function roleLabel(r: string) { return ROLE_LABELS[r] || r }

export default function AdminPage() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({ wiki_pages: 0 })
  const [currentUsername, setCurrentUsername] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({
    username: '', password: '', display_name: '', role: 'user',
    auth_source: 'local' as 'local' | 'ad',
    employee_id: '', email: '',
  })
  const [adStatus, setAdStatus] = useState<{ enabled: boolean; configured: boolean } | null>(null)
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [resetTarget, setResetTarget] = useState<string | null>(null)
  const [resetPw, setResetPw] = useState('')
  const [editTarget, setEditTarget] = useState<User | null>(null)
  const [editForm, setEditForm] = useState({ display_name: '', employee_id: '', email: '' })

  async function saveProfile() {
    if (!editTarget) return
    const res = await fetch(`/api/admin/users/${editTarget.username}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm),
    })
    if (res.ok) {
      setEditTarget(null)
      fetchUsers()
    } else {
      const d = await res.json(); alert(d.detail || '儲存失敗')
    }
  }
  const [search, setSearch] = useState('')

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/admin/users')
    if (res.ok) setUsers(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchUsers()
    fetch('/api/health').then(r => r.json()).then(d => setStats({ wiki_pages: d.wiki_pages || 0 })).catch(() => {})
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(d => d && setCurrentUsername(d.username)).catch(() => {})
    fetch('/api/admin/ad/status').then(r => r.ok ? r.json() : null).then(d => d && setAdStatus(d)).catch(() => {})
  }, [fetchUsers])

  async function createUser() {
    setFormError('')
    if (!form.username.trim()) { setFormError('帳號必填'); return }
    if (form.auth_source === 'local' && !form.password) { setFormError('本地帳號需要密碼'); return }
    setSubmitting(true)
    const res = await fetch('/api/admin/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (res.ok) {
      setShowCreate(false)
      setForm({ username: '', password: '', display_name: '', role: 'user', auth_source: 'local', employee_id: '', email: '' })
      fetchUsers()
    } else {
      const d = await res.json(); setFormError(d.detail || '建立失敗')
    }
    setSubmitting(false)
  }

  async function toggleActive(u: User) {
    await fetch(`/api/admin/users/${u.username}/${u.active ? 'deactivate' : 'activate'}`, { method: 'POST' })
    fetchUsers()
  }

  async function deleteUser(username: string) {
    if (!confirm(`確定要刪除 ${username}？`)) return
    await fetch(`/api/admin/users/${username}`, { method: 'DELETE' })
    fetchUsers()
  }

  async function resetPassword() {
    if (!resetPw || !resetTarget) return
    const res = await fetch(`/api/admin/users/${resetTarget}/reset-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_password: resetPw }),
    })
    if (res.ok) { setResetTarget(null); setResetPw('') }
    else { const d = await res.json(); alert(d.detail) }
  }

  const filtered = users.filter(u =>
    !search ||
    u.username.toLowerCase().includes(search.toLowerCase()) ||
    u.display_name.toLowerCase().includes(search.toLowerCase()),
  )
  const adminCount = users.filter(u => u.role === 'admin').length
  const editorCount = users.filter(u => u.role === 'editor').length
  const viewerCount = users.filter(u => u.role === 'user').length
  const activeCount = users.filter(u => u.active).length

  async function changeRole(username: string, newRole: string) {
    if (!confirm(`確定將 ${username} 角色變更為「${roleLabel(newRole)}」？`)) return
    const res = await fetch(`/api/admin/users/${username}/role`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: newRole }),
    })
    if (res.ok) fetchUsers()
    else { const d = await res.json(); alert(d.detail) }
  }

  return (
    <AppShell crumbs={[{ label: '系統管理', href: '/admin' }, { label: '帳號管理' }]}>
      <div className="content">
        <div className="page-head">
          <div className="title-block">
            <h1>帳號管理</h1>
            <div className="desc">
              管理可登入 LLM Wiki 的所有帳號。帳號資料儲存於 <code className="code">/data/users.json</code>，密碼以 bcrypt 雜湊。
            </div>
          </div>
          <div className="actions">
            <button className="btn btn-outline">
              <span className="material-symbols-outlined">file_download</span>匯出 CSV
            </button>
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              <span className="material-symbols-outlined">person_add</span>新增使用者
            </button>
          </div>
        </div>

        {/* Stat cards */}
        <div className="stat-row">
          <div className="stat">
            <div className="label"><span className="material-symbols-outlined">group</span>使用者總數</div>
            <div className="value">{users.length}</div>
            <div className="delta">{activeCount} 位啟用 · {users.length - activeCount} 位停用</div>
          </div>
          <div className="stat">
            <div className="label"><span className="material-symbols-outlined" style={{ color: '#1570CD' }}>shield_person</span>管理員</div>
            <div className="value" style={{ color: '#1570CD' }}>{adminCount}</div>
            <div className="delta">全部權限</div>
          </div>
          <div className="stat">
            <div className="label"><span className="material-symbols-outlined" style={{ color: '#B96A02' }}>edit_note</span>編輯者</div>
            <div className="value" style={{ color: '#B96A02' }}>{editorCount}</div>
            <div className="delta">可上傳 / 變更知識庫</div>
          </div>
          <div className="stat">
            <div className="label"><span className="material-symbols-outlined" style={{ color: 'rgb(var(--color-sf-success))' }}>person</span>一般使用者</div>
            <div className="value" style={{ color: 'rgb(var(--color-sf-success))' }}>{viewerCount}</div>
            <div className="delta">僅可瀏覽與查詢</div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="toolbar">
          <button className="filter-pill active">全部 <span className="ct">{users.length}</span></button>
          <button className="filter-pill">
            <span className="material-symbols-outlined" style={{ color: '#1570CD' }}>shield_person</span>
            管理員 <span className="ct">{adminCount}</span>
          </button>
          <button className="filter-pill">
            <span className="material-symbols-outlined" style={{ color: '#B96A02' }}>edit_note</span>
            編輯者 <span className="ct">{editorCount}</span>
          </button>
          <button className="filter-pill">
            <span className="material-symbols-outlined" style={{ color: 'rgb(var(--color-sf-success))' }}>person</span>
            一般 <span className="ct">{viewerCount}</span>
          </button>
          <div className="tb-search">
            <span className="material-symbols-outlined">search</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜尋帳號或姓名…" />
          </div>
        </div>

        {/* Create form */}
        {showCreate && (
          <div className="create-form">
            <h3>新增使用者</h3>

            {/* Auth source picker */}
            <div className="auth-source-row">
              <label className={`auth-radio ${form.auth_source === 'local' ? 'active' : ''}`}>
                <input type="radio" name="src" checked={form.auth_source === 'local'}
                  onChange={() => setForm(f => ({ ...f, auth_source: 'local' }))} />
                <span className="material-symbols-outlined">password</span>
                <div>
                  <div className="t">本地帳號</div>
                  <div className="d">密碼存在本機，首次登入強制改密</div>
                </div>
              </label>
              <label className={`auth-radio ${form.auth_source === 'ad' ? 'active' : ''} ${!adStatus?.enabled ? 'disabled' : ''}`}>
                <input type="radio" name="src" checked={form.auth_source === 'ad'}
                  onChange={() => adStatus?.enabled && setForm(f => ({ ...f, auth_source: 'ad' }))}
                  disabled={!adStatus?.enabled} />
                <span className="material-symbols-outlined">domain</span>
                <div>
                  <div className="t">AD 帳號 {!adStatus?.enabled && <span className="tag-off">未啟用</span>}</div>
                  <div className="d">登入時對公司 AD 做 LDAP bind，密碼不存本機</div>
                </div>
              </label>
            </div>

            <div className="form-grid">
              <div className="field">
                <label>{form.auth_source === 'ad' ? 'AD 帳號（sAMAccountName）*' : '帳號 *'}</label>
                <input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                  placeholder={form.auth_source === 'ad' ? 'john.doe' : 'login_name'} className="text-input" />
              </div>
              <div className="field">
                <label>顯示名稱</label>
                <input value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
                  placeholder="張三" className="text-input" />
              </div>
              <div className="field">
                <label>員工編號（選填）</label>
                <input value={form.employee_id} onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))}
                  placeholder="A12345" className="text-input" />
              </div>
              <div className="field">
                <label>Email（選填）</label>
                <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="user@example.com" className="text-input" />
              </div>
              {form.auth_source === 'local' ? (
                <div className="field">
                  <label>初始密碼 *（最少 8 碼，使用者首次登入會被強制改）</label>
                  <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    className="text-input" />
                </div>
              ) : (
                <div className="field">
                  <label>密碼</label>
                  <div className="text-input" style={{ display: 'flex', alignItems: 'center', color: 'var(--text-secondary)', background: 'var(--bg-surface-variant)' }}>
                    由 AD 認證，本系統不儲存密碼
                  </div>
                </div>
              )}
              <div className="field">
                <label>角色</label>
                <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                  className="text-input">
                  <option value="user">一般使用者（只能瀏覽 / 查詢）</option>
                  <option value="editor">編輯者（+ 可上傳檔案 / 變更知識庫）</option>
                  <option value="admin">管理員（+ 使用者管理 / 批次操作 / 操作日誌）</option>
                </select>
              </div>
            </div>
            {formError && <p className="form-error">{formError}</p>}
            <div className="form-actions">
              <button onClick={createUser} disabled={submitting} className="btn btn-primary sm">
                {submitting ? '建立中…' : '建立'}
              </button>
              <button onClick={() => { setShowCreate(false); setFormError('') }} className="btn btn-outline sm">
                取消
              </button>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="grid-wrap">
          {loading ? (
            <div className="empty-state">
              <span className="material-symbols-outlined ic">hourglass_top</span>
              <p>載入中…</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <span className="material-symbols-outlined ic">person_off</span>
              <p>沒有符合條件的使用者</p>
            </div>
          ) : (
            <table className="grid">
              <thead>
                <tr>
                  <th>帳號</th>
                  <th>顯示名稱</th>
                  <th>角色</th>
                  <th>狀態</th>
                  <th className="col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => (
                  <tr key={u.username}>
                    <td>
                      <div className="cell-title">
                        <div className={`ic ${u.auth_source === 'ad' ? 'ad' : 'local'}`}>
                          <span className="material-symbols-outlined">
                            {u.auth_source === 'ad' ? 'domain' : 'person'}
                          </span>
                        </div>
                        <div className="text">
                          <div className="name">
                            {u.username}
                            <span className={`auth-pill ${u.auth_source === 'ad' ? 'ad' : 'local'}`}>
                              {u.auth_source === 'ad' ? 'AD' : '本地'}
                            </span>
                          </div>
                          <div className="filename">
                            {u.auth_source === 'ad' ? '由 AD 認證' : '本地密碼'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="profile-cell">
                        <div className="dn">{u.display_name}</div>
                        <div className="meta">
                          {u.employee_id && <span className="meta-item">#{u.employee_id}</span>}
                          {u.email && <span className="meta-item">{u.email}</span>}
                        </div>
                      </div>
                    </td>
                    <td>
                      <select
                        value={u.role}
                        onChange={e => changeRole(u.username, e.target.value)}
                        disabled={u.username === currentUsername}
                        className={`role-select role-${u.role}`}
                        title={u.username === currentUsername ? '不能變更自己的角色' : '點擊變更角色'}
                      >
                        <option value="admin">管理員</option>
                        <option value="editor">編輯者</option>
                        <option value="user">一般使用者</option>
                      </select>
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span className={`badge ${u.active ? 'badge-active' : 'badge-inactive'}`}>
                          {u.active ? '啟用' : '停用'}
                        </span>
                        {u.must_change_password && (
                          <span className="badge badge-pending" title="使用者下次登入須改密碼">
                            待改密碼
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="col-actions">
                      <div className="row-actions" style={{ opacity: 1 }}>
                        <button className="ra-btn" title="編輯資料" onClick={() => {
                          setEditTarget(u)
                          setEditForm({
                            display_name: u.display_name,
                            employee_id: u.employee_id || '',
                            email: u.email || '',
                          })
                        }}>
                          <span className="material-symbols-outlined">edit</span>
                        </button>
                        {u.auth_source !== 'ad' && (
                          <button className="ra-btn" title="重設密碼" onClick={() => { setResetTarget(u.username); setResetPw('') }}>
                            <span className="material-symbols-outlined">key</span>
                          </button>
                        )}
                        <button className="ra-btn" title={u.active ? '停用' : '啟用'} onClick={() => toggleActive(u)}>
                          <span className="material-symbols-outlined">{u.active ? 'block' : 'check'}</span>
                        </button>
                        <button className="ra-btn danger" title="刪除" onClick={() => deleteUser(u.username)}>
                          <span className="material-symbols-outlined">delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Edit profile modal */}
      {editTarget && (
        <div className="modal-overlay" onClick={() => setEditTarget(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <h3>編輯使用者資料</h3>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '4px 0 16px' }}>
              <code className="code">{editTarget.username}</code>
              <span className={`auth-pill ${editTarget.auth_source === 'ad' ? 'ad' : 'local'}`} style={{ marginLeft: 8 }}>
                {editTarget.auth_source === 'ad' ? 'AD' : '本地'}
              </span>
            </p>
            <div className="field" style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, display: 'block' }}>顯示名稱</label>
              <input value={editForm.display_name} onChange={e => setEditForm(f => ({ ...f, display_name: e.target.value }))}
                className="text-input" style={{ width: '100%' }} />
            </div>
            <div className="field" style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, display: 'block' }}>員工編號</label>
              <input value={editForm.employee_id} onChange={e => setEditForm(f => ({ ...f, employee_id: e.target.value }))}
                placeholder="A12345" className="text-input" style={{ width: '100%' }} />
            </div>
            <div className="field" style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, display: 'block' }}>Email</label>
              <input type="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                placeholder="user@example.com" className="text-input" style={{ width: '100%' }} />
            </div>
            <div className="form-actions">
              <button onClick={saveProfile} className="btn btn-primary sm">儲存</button>
              <button onClick={() => setEditTarget(null)} className="btn btn-outline sm">取消</button>
            </div>
          </div>
        </div>
      )}

      {/* Reset password modal */}
      {resetTarget && (
        <div className="modal-overlay" onClick={() => setResetTarget(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>重設密碼</h3>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '4px 0 16px' }}>
              為 <code className="code">{resetTarget}</code> 設定新密碼
            </p>
            <input type="password" value={resetPw} onChange={e => setResetPw(e.target.value)}
              placeholder="新密碼（最少 8 碼）" className="text-input" autoFocus />
            <div className="form-actions" style={{ marginTop: 16 }}>
              <button onClick={resetPassword} className="btn btn-primary sm">確認</button>
              <button onClick={() => setResetTarget(null)} className="btn btn-outline sm">取消</button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .content { flex: 1; overflow-y: auto; padding-bottom: 12px; }

        .page-head {
          padding: 24px 28px 0;
          display: flex; align-items: flex-end; justify-content: space-between; gap: 24px;
          flex-wrap: wrap;
        }
        .page-head h1 { margin: 0 0 4px; font-size: 24px; font-weight: 500; letter-spacing: -0.2px; }
        .page-head .desc { font-size: 13px; color: var(--text-secondary); max-width: 640px; }
        .actions { display: flex; align-items: center; gap: 8px; }

        .stat-row {
          padding: 20px 28px 0;
          display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;
        }
        .stat {
          border: 1px solid var(--border-default); border-radius: 8px;
          padding: 14px 16px; background: #fff;
          display: flex; flex-direction: column; gap: 2px;
        }
        .stat .label {
          font-size: 12px; color: var(--text-secondary);
          display: flex; align-items: center; gap: 6px;
        }
        .stat .label :global(.material-symbols-outlined) { font-size: 16px; }
        .stat .value {
          font-size: 26px; font-weight: 500; line-height: 1.2;
          font-variant-numeric: tabular-nums; letter-spacing: -0.4px;
        }
        .stat .delta {
          font-size: 11px; font-family: var(--font-family-mono);
          color: var(--text-secondary); margin-top: 2px;
        }
        .stat .delta.up { color: rgb(var(--color-sf-success)); }

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
        .filter-pill .ct { font-family: var(--font-family-mono); font-size: 11px; opacity: .7; margin-left: 2px; }

        .tb-search { margin-left: auto; position: relative; width: 280px; }
        .tb-search input {
          height: 32px; width: 100%; padding: 0 12px 0 32px;
          background: #fff; border: 1px solid var(--border-default); border-radius: 6px;
          font: inherit; font-size: 13px; outline: none;
          transition: border-color 120ms;
        }
        .tb-search input:focus {
          border-color: rgb(var(--color-sf-primary));
          box-shadow: 0 0 0 4px rgba(40,119,238,.16);
        }
        .tb-search :global(.material-symbols-outlined) {
          position: absolute; left: 8px; top: 50%; transform: translateY(-50%);
          font-size: 16px; color: var(--text-secondary);
        }

        .create-form {
          margin: 16px 28px 0;
          padding: 20px;
          border: 1px solid rgba(40,119,238,.3);
          border-radius: 12px;
          background: rgba(40,119,238,.02);
        }
        .create-form h3 { margin: 0 0 16px; font-size: 14px; font-weight: 500; }
        .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 16px; margin-bottom: 12px; }
        .field { display: flex; flex-direction: column; gap: 4px; }
        .field label { font-size: 12px; font-weight: 500; }
        .text-input {
          height: 36px; padding: 0 12px;
          border: 1px solid var(--border-default); border-radius: 6px;
          font: inherit; font-size: 13px; background: #fff;
          outline: none; transition: border-color 120ms;
        }
        .text-input:focus {
          border-color: rgb(var(--color-sf-primary));
          box-shadow: 0 0 0 4px rgba(40,119,238,.16);
        }
        .form-error { color: rgb(var(--color-sf-error)); font-size: 12px; margin: 0 0 12px; }
        .form-actions { display: flex; gap: 8px; }

        .grid-wrap { padding: 0 28px 12px; }
        .grid {
          width: 100%; border-collapse: collapse; font-size: 13px;
        }
        .grid thead th {
          background: linear-gradient(0deg, rgba(40,119,238,.05), rgba(40,119,238,.05)), #fff;
          height: 45px; padding: 0 14px;
          text-align: left; font-weight: 500; font-size: 13px;
          color: var(--text-primary);
          border-top: 1px solid var(--border-default);
          border-bottom: 1px solid var(--border-default);
          white-space: nowrap;
        }
        .grid thead th.col-actions { width: 132px; text-align: right; padding-right: 14px; }
        .grid tbody td {
          height: 56px; padding: 0 14px;
          border-bottom: 1px solid var(--border-default);
          color: var(--text-primary);
          vertical-align: middle;
        }
        .grid tbody tr:hover td { background: rgba(40,119,238,.04); }

        .cell-title { display: flex; align-items: center; gap: 10px; min-width: 0; }
        .cell-title .ic {
          width: 32px; height: 32px; border-radius: 6px;
          display: grid; place-items: center; flex-shrink: 0;
          background: rgba(40,119,238,.08); color: rgb(var(--color-sf-primary));
        }
        .cell-title .ic.ad { background: rgba(155,89,182,.12); color: #7B3FA8; }
        .cell-title .ic :global(.material-symbols-outlined) { font-size: 18px; }

        .profile-cell .dn { font-size: 13.5px; }
        .profile-cell .meta {
          font-size: 11px; color: var(--text-secondary);
          margin-top: 2px;
          display: flex; gap: 8px;
          font-family: var(--font-family-mono);
        }
        .profile-cell .meta-item { display: inline-block; }

        .auth-pill {
          display: inline-block; margin-left: 6px;
          padding: 1px 6px; border-radius: 3px;
          font-size: 10px; font-weight: 500;
          font-family: var(--font-family-mono);
        }
        .auth-pill.local { background: var(--bg-surface-variant); color: var(--text-secondary); }
        .auth-pill.ad { background: rgba(155,89,182,.14); color: #7B3FA8; }

        .auth-source-row {
          display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
          margin-bottom: 16px;
        }
        .auth-radio {
          display: flex; align-items: center; gap: 12px;
          padding: 12px 14px; border: 1px solid var(--border-default); border-radius: 8px;
          cursor: pointer; transition: all 120ms; background: #fff;
        }
        .auth-radio:hover:not(.disabled) { border-color: rgba(40,119,238,.5); }
        .auth-radio.active { border-color: rgb(var(--color-sf-primary)); background: rgba(40,119,238,.04); }
        .auth-radio.disabled { opacity: .5; cursor: not-allowed; }
        .auth-radio input { display: none; }
        .auth-radio :global(.material-symbols-outlined) {
          font-size: 22px; color: var(--text-secondary); flex-shrink: 0;
        }
        .auth-radio.active :global(.material-symbols-outlined) { color: rgb(var(--color-sf-primary)); }
        .auth-radio .t { font-size: 14px; font-weight: 500; display: flex; align-items: center; gap: 6px; }
        .auth-radio .d { font-size: 11.5px; color: var(--text-secondary); margin-top: 2px; }
        .tag-off {
          font-size: 10px; padding: 1px 6px; border-radius: 3px;
          background: var(--bg-surface-variant); color: var(--text-secondary);
          font-family: var(--font-family-mono); font-weight: 400;
        }
        .cell-title .text { line-height: 1.3; }
        .cell-title .name { font-weight: 500; font-size: 13.5px; color: var(--text-primary); }
        .cell-title .filename {
          font-size: 11px; color: var(--text-secondary);
          font-family: var(--font-family-mono);
        }

        .type-chip {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 2px 8px; border-radius: 4px;
          font-size: 11px; font-weight: 500;
          font-family: var(--font-family-mono); letter-spacing: .3px;
        }
        .type-source { background: rgba(46,144,250,.14); color: #1570CD; }
        .type-concept { background: rgba(18,183,106,.14); color: rgb(var(--color-sf-success)); }

        .role-select {
          height: 28px; padding: 0 24px 0 10px;
          border: 1px solid transparent; border-radius: 4px;
          background: transparent; cursor: pointer;
          font: inherit; font-size: 12px; font-weight: 500;
          appearance: none;
          background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%);
          background-position: calc(100% - 12px) 12px, calc(100% - 8px) 12px;
          background-size: 4px 4px;
          background-repeat: no-repeat;
        }
        .role-select:hover:not(:disabled) {
          background-color: rgba(15,23,42,.04);
        }
        .role-select:disabled { cursor: not-allowed; opacity: .8; }
        .role-select.role-admin { color: #1570CD; background-color: rgba(46,144,250,.14); }
        .role-select.role-admin:hover:not(:disabled) { background-color: rgba(46,144,250,.22); }
        .role-select.role-editor { color: #B96A02; background-color: rgba(247,144,9,.14); }
        .role-select.role-editor:hover:not(:disabled) { background-color: rgba(247,144,9,.22); }
        .role-select.role-user { color: rgb(var(--color-sf-success)); background-color: rgba(18,183,106,.14); }
        .role-select.role-user:hover:not(:disabled) { background-color: rgba(18,183,106,.22); }

        .badge {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 2px 8px; border-radius: 4px;
          font-size: 11px; font-weight: 500;
          border: 1px solid;
        }
        .badge-active { background: rgba(18,183,106,.12); color: rgb(var(--color-sf-success)); border-color: rgb(var(--color-sf-success)); }
        .badge-inactive { background: rgba(244,73,62,.12); color: rgb(var(--color-sf-danger)); border-color: rgb(var(--color-sf-danger)); }
        .badge-pending { background: rgba(247,144,9,.12); color: rgb(var(--color-sf-warning)); border-color: rgb(var(--color-sf-warning)); }

        .row-actions { display: inline-flex; gap: 2px; }
        .ra-btn {
          width: 28px; height: 28px; border-radius: 4px;
          border: 0; background: transparent; cursor: pointer;
          color: var(--text-secondary);
          display: grid; place-items: center;
          transition: background 120ms, color 120ms;
        }
        .ra-btn:hover { background: rgba(15,23,42,.08); color: var(--text-primary); }
        .ra-btn .material-symbols-outlined { font-size: 16px; }
        .ra-btn.danger:hover { background: rgba(244,73,62,.12); color: rgb(var(--color-sf-danger)); }

        .empty-state { padding: 60px 28px; text-align: center; color: var(--text-secondary); }
        .empty-state .ic { font-size: 48px; opacity: .4; }
        .empty-state p { margin: 8px 0 0; }

        .modal-overlay {
          position: fixed; inset: 0; z-index: 50;
          background: rgba(15,23,42,.4);
          display: flex; align-items: center; justify-content: center;
          padding: 20px;
        }
        .modal {
          background: #fff; border-radius: 16px;
          padding: 24px; width: 100%; max-width: 380px;
          box-shadow: var(--shadow-e3);
        }
        .modal h3 { margin: 0; font-size: 16px; font-weight: 500; }
        .modal .text-input { width: 100%; height: 40px; }
      `}</style>
    </AppShell>
  )
}
