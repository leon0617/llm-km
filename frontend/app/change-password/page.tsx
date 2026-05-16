'use client'
import { useState, Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function ChangePasswordForm() {
  const router = useRouter()
  const params = useSearchParams()
  const [user, setUser] = useState<{ username: string; display_name: string } | null>(null)
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [error, setError] = useState<{ title: string; msg: string } | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(d => {
      if (!d) router.push('/login')
      else setUser(d)
    })
  }, [router])

  // Password strength rules
  const rules = {
    rLen: newPw.length >= 8,
    rMix: /[A-Za-z]/.test(newPw) && /\d/.test(newPw),
    rUser: !!user && newPw.length > 0 && !newPw.toLowerCase().includes(user.username.toLowerCase()),
    rOld: newPw.length > 0 && newPw !== oldPw,
  }
  const score = Object.values(rules).filter(Boolean).length
  const allOk = score === 4 && confirmPw === newPw && confirmPw.length > 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!allOk || loading) return
    if (newPw !== confirmPw) {
      setError({ title: '密碼不一致', msg: '兩次輸入的新密碼必須相同' })
      return
    }
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_password: oldPw, new_password: newPw }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError({ title: '密碼變更失敗', msg: data.detail || '請稍後再試' })
        return
      }
      const next = params.get('next') || '/query'
      router.push(next)
      router.refresh()
    } catch {
      setError({ title: '連線失敗', msg: '無法連接伺服器' })
    } finally {
      setLoading(false)
    }
  }

  const segColor = (i: number) => {
    if (i >= score) return 'var(--border-default)'
    if (score <= 1) return 'rgb(var(--color-sf-danger))'
    if (score === 2) return 'rgb(var(--color-sf-warning))'
    if (score === 3) return '#1570CD'
    return 'rgb(var(--color-sf-success))'
  }

  return (
    <div className="page" style={{ display: 'grid', gridTemplateColumns: '520px 1fr', height: '100vh' }}>
      <aside className="brand-side">
        <div className="brand-head">
          <div className="brand-mark">KM</div>
          <div className="brand-name">
            LLM Wiki
            <div className="sub">內部知識庫</div>
          </div>
        </div>
        <div className="brand-hero">
          <div className="eyebrow">Security</div>
          <h1>請先設定<br /><b>您的新密碼</b></h1>
          <p>為了保護您的帳號，首次登入需將預設密碼或管理員提供的臨時密碼，改為僅您本人知道的新密碼。</p>
          <div className="feat-list">
            <div className="feat"><span className="material-symbols-outlined">lock</span>至少 8 個字元</div>
            <div className="feat"><span className="material-symbols-outlined">abc</span>含英數混合</div>
            <div className="feat"><span className="material-symbols-outlined">person_off</span>不含帳號</div>
            <div className="feat"><span className="material-symbols-outlined">history_toggle_off</span>與舊密碼不同</div>
          </div>
        </div>
        <div className="brand-foot">
          <span>v1.0.0 · build 20260510</span>
          <span className="stat-dot">服務正常</span>
        </div>
      </aside>

      <section className="form-side">
        <div className="top-strip">
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {user ? `${user.display_name} (${user.username})` : '…'}
          </span>
        </div>
        <div className="form-stage">
          <div className="card">
            <div className="step-rail">
              <div className="step done"><span className="num" /></div>身分驗證
              <div className="bar" />
              <div className="step active"><span className="num">2</span></div>變更密碼
              <div className="bar" />
              <div className="step"><span className="num">3</span></div>進入系統
            </div>

            <div className="welcome-eyebrow">First-time login</div>
            <h2 className="welcome-title">請先設定您的新密碼</h2>
            <p className="welcome-desc">變更成功後將自動登入並進入系統首頁。</p>

            {error && (
              <div className="form-alert">
                <span className="material-symbols-outlined">error</span>
                <div className="body">
                  <div className="t">{error.title}</div>
                  <div className="msg">{error.msg}</div>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} autoComplete="off">
              <div className="field">
                <label>目前的密碼 <span className="req">*</span></label>
                <div className="input-wrap">
                  <span className="material-symbols-outlined lead">key</span>
                  <input className="input-big" type="password"
                    value={oldPw} onChange={e => setOldPw(e.target.value)}
                    placeholder="管理員提供的臨時密碼"
                    autoComplete="current-password" autoFocus />
                </div>
              </div>

              <div className="field">
                <label>新密碼 <span className="req">*</span></label>
                <div className="input-wrap">
                  <span className="material-symbols-outlined lead">lock</span>
                  <input className="input-big" type="password"
                    value={newPw} onChange={e => setNewPw(e.target.value)}
                    placeholder="設定新密碼"
                    autoComplete="new-password" />
                </div>
              </div>

              <div className="pw-strength">
                <div className="pw-bars">
                  {[0, 1, 2, 3].map(i => (
                    <span key={i} className="seg" style={{ background: segColor(i) }} />
                  ))}
                </div>
                <div className="pw-rules">
                  <span className={`rule ${rules.rLen ? 'ok' : ''}`}>
                    <span className="material-symbols-outlined">{rules.rLen ? 'check_circle' : 'circle'}</span>
                    至少 8 個字元
                  </span>
                  <span className={`rule ${rules.rMix ? 'ok' : ''}`}>
                    <span className="material-symbols-outlined">{rules.rMix ? 'check_circle' : 'circle'}</span>
                    含英文字母與數字
                  </span>
                  <span className={`rule ${rules.rUser ? 'ok' : ''}`}>
                    <span className="material-symbols-outlined">{rules.rUser ? 'check_circle' : 'circle'}</span>
                    不含帳號
                  </span>
                  <span className={`rule ${rules.rOld ? 'ok' : ''}`}>
                    <span className="material-symbols-outlined">{rules.rOld ? 'check_circle' : 'circle'}</span>
                    與舊密碼不同
                  </span>
                </div>
              </div>

              <div className="field">
                <label>再次輸入新密碼 <span className="req">*</span></label>
                <div className="input-wrap">
                  <span className="material-symbols-outlined lead">lock</span>
                  <input className="input-big" type="password"
                    value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                    placeholder="確認新密碼"
                    autoComplete="new-password" />
                </div>
                {confirmPw.length > 0 && confirmPw !== newPw && (
                  <div style={{ fontSize: 12, color: 'rgb(var(--color-sf-error))', marginTop: 4 }}>
                    兩次密碼不一致
                  </div>
                )}
              </div>

              <button type="submit" className={`submit-btn ${loading ? 'loading' : ''}`}
                disabled={!allOk || loading}>
                <span className="spin" />
                <span className="label">{loading ? '儲存中…' : '儲存並繼續'}</span>
              </button>
            </form>
          </div>
        </div>
      </section>

      <style jsx>{`
        .brand-side {
          background: rgb(var(--color-sf-on-primary-container));
          color: #fff;
          position: relative; padding: 40px 48px;
          display: flex; flex-direction: column; overflow: hidden;
        }
        .brand-side::before {
          content: ''; position: absolute; inset: 0;
          background-image:
            linear-gradient(rgba(255,255,255,.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,.04) 1px, transparent 1px);
          background-size: 32px 32px;
          mask-image: radial-gradient(ellipse 90% 70% at 30% 30%, #000 30%, transparent 80%);
          pointer-events: none;
        }
        .brand-side::after {
          content: ''; position: absolute;
          width: 480px; height: 480px; border-radius: 50%;
          right: -180px; bottom: -180px;
          background: radial-gradient(circle, rgba(40,119,238,.35) 0%, transparent 70%);
          pointer-events: none;
        }
        .brand-head { display: flex; align-items: center; gap: 12px; position: relative; z-index: 1; }
        .brand-mark {
          width: 40px; height: 40px; border-radius: 10px;
          background: rgb(var(--color-sf-primary));
          display: grid; place-items: center;
          font-weight: 700; font-size: 14px; color: #fff;
          box-shadow: 0 4px 12px rgba(40,119,238,.4);
        }
        .brand-name { font-size: 16px; font-weight: 600; line-height: 1.1; }
        .brand-name .sub { font-size: 11px; opacity: .55; font-family: var(--font-family-mono); margin-top: 2px; }
        .brand-hero { margin-top: auto; position: relative; z-index: 1; }
        .brand-hero .eyebrow {
          font-size: 11px; letter-spacing: 2px; text-transform: uppercase;
          opacity: .65; font-family: var(--font-family-mono); margin-bottom: 16px;
        }
        .brand-hero h1 { margin: 0; font-size: 36px; font-weight: 500; line-height: 1.25; letter-spacing: -0.4px; }
        .brand-hero h1 :global(b) { color: rgb(var(--color-sf-primary)); font-weight: 500; }
        .brand-hero p { margin: 16px 0 0; max-width: 420px; line-height: 1.7; font-size: 14px; opacity: .8; }
        .feat-list {
          margin-top: 36px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px 20px;
          max-width: 420px; position: relative; z-index: 1;
        }
        .feat { display: flex; align-items: center; gap: 10px; font-size: 13px; opacity: .85; }
        .feat :global(.material-symbols-outlined) {
          font-size: 18px; color: rgb(var(--color-sf-primary));
          background: rgba(40,119,238,.15);
          width: 28px; height: 28px; border-radius: 6px;
          display: grid; place-items: center;
        }
        .brand-foot {
          margin-top: 28px; padding-top: 20px;
          border-top: 1px solid rgba(255,255,255,.1);
          display: flex; align-items: center; justify-content: space-between;
          font-size: 11px; font-family: var(--font-family-mono); opacity: .55;
          position: relative; z-index: 1;
        }
        .stat-dot { display: inline-flex; align-items: center; gap: 6px; }
        .stat-dot::before {
          content: ''; width: 6px; height: 6px; border-radius: 50%;
          background: rgb(var(--color-sf-success)); box-shadow: 0 0 8px rgb(var(--color-sf-success));
        }

        .form-side {
          background-image: linear-gradient(90deg, rgba(40,119,238,.05), rgba(40,119,238,.05)), linear-gradient(90deg, #fff, #fff);
          display: flex; flex-direction: column; overflow-y: auto;
        }
        .top-strip {
          height: 48px; flex-shrink: 0;
          display: flex; align-items: center; justify-content: flex-end;
          padding: 0 32px;
        }
        .form-stage {
          flex: 1; min-height: 0;
          display: flex; align-items: center; justify-content: center;
          padding: 24px 32px 48px;
        }
        .card { width: 100%; max-width: 440px; }

        .step-rail {
          display: flex; align-items: center; gap: 10px; margin: 0 0 28px;
          font-size: 12px; color: var(--text-secondary);
        }
        .step { display: flex; align-items: center; opacity: .5; }
        .step.active { opacity: 1; color: var(--text-primary); font-weight: 500; }
        .step.done { opacity: 1; color: rgb(var(--color-sf-success)); }
        .step .num {
          width: 22px; height: 22px; border-radius: 50%;
          background: var(--bg-surface-variant); color: var(--text-secondary);
          display: grid; place-items: center; font-weight: 600; font-size: 11px;
          font-family: var(--font-family-mono); margin-right: 6px;
        }
        .step.active .num { background: rgb(var(--color-sf-primary)); color: #fff; }
        .step.done .num { background: rgb(var(--color-sf-success)); color: #fff; }
        .step.done .num::after { content: '✓'; }
        .bar { flex: 1; height: 1px; background: var(--border-default); }

        .welcome-eyebrow {
          font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase;
          color: var(--text-secondary); font-family: var(--font-family-mono); margin-bottom: 8px;
        }
        .welcome-title { margin: 0 0 8px; font-size: 28px; font-weight: 500; letter-spacing: -0.3px; }
        .welcome-desc { color: var(--text-secondary); font-size: 14px; line-height: 1.6; margin: 0 0 24px; }

        .field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
        .field label { font-size: 13px; font-weight: 500; }
        .field label .req { color: rgb(var(--color-sf-error)); }
        .input-wrap { position: relative; }
        .input-wrap :global(.lead) {
          position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
          color: var(--text-secondary); pointer-events: none;
        }
        .input-big {
          width: 100%; height: 48px; padding: 0 14px 0 42px;
          background: #fff; border: 1px solid var(--border-default);
          border-radius: 8px; font-family: inherit; font-size: 14.5px;
          color: var(--text-primary); outline: none;
          transition: border-color 150ms, box-shadow 150ms;
        }
        .input-big:hover { border-color: var(--border-strong); }
        .input-big:focus {
          border-color: rgb(var(--color-sf-primary));
          box-shadow: 0 0 0 4px rgba(40,119,238,.16);
        }

        .pw-strength { margin: -10px 0 16px; display: flex; flex-direction: column; gap: 8px; }
        .pw-bars { display: flex; gap: 4px; }
        .pw-bars .seg { flex: 1; height: 4px; border-radius: 999px; transition: background 200ms; }
        .pw-rules {
          display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px;
          font-size: 12px; color: var(--text-secondary);
        }
        .pw-rules .rule { display: inline-flex; align-items: center; gap: 4px; }
        .pw-rules .rule :global(.material-symbols-outlined) { font-size: 14px; }
        .pw-rules .rule.ok { color: rgb(var(--color-sf-success)); }

        .submit-btn {
          width: 100%; height: 48px; border: 0; border-radius: 8px;
          background: rgb(var(--color-sf-primary)); color: #fff;
          font: 500 15px/1 inherit; cursor: pointer;
          display: inline-flex; align-items: center; justify-content: center; gap: 8px;
          transition: background 150ms, transform 80ms;
        }
        .submit-btn:hover:not(:disabled) { background: rgb(31,87,209); }
        .submit-btn:disabled { opacity: .5; cursor: not-allowed; }
        .submit-btn .spin { display: none; width: 18px; height: 18px;
          border: 2px solid rgba(255,255,255,.4); border-top-color: #fff;
          border-radius: 50%; animation: spin 700ms linear infinite; }
        .submit-btn.loading .spin { display: inline-block; }
        @keyframes spin { to { transform: rotate(360deg); } }

        .form-alert {
          display: flex; align-items: flex-start; gap: 10px;
          padding: 12px 14px; border-radius: 8px;
          background: rgb(var(--color-sf-error-container));
          color: rgb(var(--color-sf-on-error-container));
          margin-bottom: 20px; font-size: 13px;
        }
        .form-alert :global(.material-symbols-outlined) { font-size: 20px; color: rgb(var(--color-sf-error)); }
        .form-alert .body .t { font-weight: 600; margin-bottom: 2px; }
      `}</style>
    </div>
  )
}

export default function ChangePasswordPage() {
  return <Suspense><ChangePasswordForm /></Suspense>
}
