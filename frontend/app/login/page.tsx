'use client'
import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const [empId, setEmpId] = useState('')
  const [pw, setPw] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [remember, setRemember] = useState(false)
  const [error, setError] = useState<{ title: string; msg: string } | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!empId.trim()) { setError({ title: '請輸入帳號', msg: '帳號欄位不能為空' }); return }
    if (!pw) { setError({ title: '請輸入密碼', msg: '密碼欄位不能為空' }); return }
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: empId.trim(), password: pw }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError({ title: '帳號或密碼錯誤', msg: data.detail || '請確認員工編號與密碼後重試。' })
        return
      }
      const data = await res.json()
      const next = params.get('next') || '/query'
      if (data.must_change_password) {
        router.push(`/change-password?next=${encodeURIComponent(next)}`)
      } else {
        router.push(next)
      }
      router.refresh()
    } catch {
      setError({ title: '連線失敗', msg: '無法連接伺服器，請稍後再試。' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page" style={{ display: 'grid', gridTemplateColumns: '520px 1fr', height: '100vh' }}>
      {/* ════ Left: brand panel ════ */}
      <aside className="brand-side">
        <div className="brand-head">
          <div className="brand-mark">KM</div>
          <div className="brand-name">
            LLM Wiki
            <div className="sub">內部知識庫</div>
          </div>
        </div>

        <div className="brand-hero">
          <div className="eyebrow">Knowledge Management</div>
          <h1>把個人的<br /><b>經驗及網路文章</b><br />壓縮成可查詢的知識</h1>
          <p>整合 Obsidian Vault 與 LLM API，能夠以繁體中文直接提問，系統自動翻找已策展的 Wiki 頁回答，並可上傳文件持續累積集體經驗。</p>

          <div className="feat-list">
            <div className="feat"><span className="material-symbols-outlined">forum</span>聊天查詢</div>
            <div className="feat"><span className="material-symbols-outlined">upload_file</span>文件上傳</div>
            <div className="feat"><span className="material-symbols-outlined">link</span>交叉引用</div>
            <div className="feat"><span className="material-symbols-outlined">history</span>操作留痕</div>
          </div>
        </div>

        <div className="brand-foot">
          <span>v1.0.0 · build 20260509</span>
          <span className="stat-dot">服務正常</span>
        </div>
      </aside>

      {/* ════ Right: form panel ════ */}
      <section className="form-side">
        <div className="top-strip">
          <a href="#"><span className="material-symbols-outlined">help_outline</span>使用說明</a>
          <a href="#"><span className="material-symbols-outlined">support_agent</span>聯絡 IT</a>
        </div>

        <div className="form-stage">
          <div className="card view active">
            <div className="welcome-eyebrow">Sign in</div>
            <h2 className="welcome-title">歡迎使用 LLM Wiki</h2>
            <p className="welcome-desc">請以公司帳號登入。首次登入後系統會引導您變更預設密碼。</p>

            {error && (
              <div className="form-alert">
                <span className="material-symbols-outlined">error</span>
                <div className="body">
                  <div className="t">{error.title}</div>
                  <div className="msg">{error.msg}</div>
                </div>
              </div>
            )}

            <form onSubmit={handleLogin} autoComplete="off">
              <div className="field">
                <label htmlFor="empId">帳號 <span className="req">*</span></label>
                <div className="input-wrap">
                  <span className="material-symbols-outlined lead">badge</span>
                  <input id="empId" className="input-big" placeholder="例如 A12345"
                    value={empId} onChange={e => setEmpId(e.target.value)}
                    autoComplete="username" autoFocus />
                </div>
              </div>

              <div className="field">
                <label htmlFor="pw">
                  密碼 <span className="req">*</span>
                  <a href="#" className="help-link" onClick={e => e.preventDefault()}>忘記密碼？</a>
                </label>
                <div className="input-wrap">
                  <span className="material-symbols-outlined lead">lock</span>
                  <input id="pw" className="input-big" type={showPw ? 'text' : 'password'}
                    placeholder="請輸入密碼"
                    value={pw} onChange={e => setPw(e.target.value)}
                    autoComplete="current-password" />
                  <button type="button" className="trail" tabIndex={-1}
                    onClick={() => setShowPw(s => !s)}
                    aria-label="顯示/隱藏密碼">
                    <span className="material-symbols-outlined">{showPw ? 'visibility_off' : 'visibility'}</span>
                  </button>
                </div>
              </div>

              <div className="opts">
                <button type="button" className={`check ${remember ? 'on' : ''}`}
                  onClick={() => setRemember(r => !r)}>
                  <span className="box"></span>於此裝置保持登入 14 天
                </button>
                <a href="#" onClick={e => e.preventDefault()}>需要協助？</a>
              </div>

              <button type="submit" className={`submit-btn ${loading ? 'loading' : ''}`}
                disabled={loading}>
                <span className="spin"></span>
                <span className="label">{loading ? '登入中…' : '登入'}</span>
              </button>
            </form>

            <div className="form-foot">
<span>© 2026 LLM Wiki</span>
<span>leonl-km.lbest.online</span>
            </div>
          </div>
        </div>
      </section>

      <style jsx>{`
        .brand-side {
          background: rgb(var(--color-sf-on-primary-container));
          color: #fff;
          position: relative;
          padding: 40px 48px;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .brand-side::before {
          content: '';
          position: absolute; inset: 0;
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
          font-weight: 700; font-size: 14px; letter-spacing: 0.6px; color: #fff;
          box-shadow: 0 4px 12px rgba(40,119,238,.4);
        }
        .brand-name { font-size: 16px; font-weight: 600; line-height: 1.1; }
        .brand-name .sub { font-size: 11px; opacity: .55; font-family: var(--font-family-mono); margin-top: 2px; letter-spacing: .4px; }
        .brand-hero { margin-top: auto; position: relative; z-index: 1; }
        .brand-hero .eyebrow {
          font-size: 11px; letter-spacing: 2px; text-transform: uppercase;
          opacity: .65; font-family: var(--font-family-mono); margin-bottom: 16px;
        }
        .brand-hero h1 {
          margin: 0; font-size: 36px; font-weight: 500; line-height: 1.25;
          letter-spacing: -0.4px;
        }
        .brand-hero h1 :global(b) { color: rgb(var(--color-sf-primary)); font-weight: 500; }
        .brand-hero p {
          margin: 16px 0 0; max-width: 420px; line-height: 1.7;
          font-size: 14px; opacity: .8;
        }
        .feat-list {
          margin-top: 36px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px 20px;
          max-width: 420px; position: relative; z-index: 1;
        }
        .feat {
          display: flex; align-items: center; gap: 10px;
          font-size: 13px; opacity: .85;
        }
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
          background: rgb(var(--color-sf-success));
          box-shadow: 0 0 8px rgb(var(--color-sf-success));
        }

        .form-side {
          background-image:
            linear-gradient(90deg, rgba(40,119,238,.05), rgba(40,119,238,.05)),
            linear-gradient(90deg, #fff, #fff);
          display: flex; flex-direction: column; overflow-y: auto;
        }
        .top-strip {
          height: 48px; flex-shrink: 0;
          display: flex; align-items: center; justify-content: flex-end;
          padding: 0 32px; gap: 16px;
          font-size: 12px; color: var(--text-secondary);
        }
        .top-strip a { color: var(--text-secondary); text-decoration: none; display: inline-flex; align-items: center; gap: 4px; }
        .top-strip a:hover { color: rgb(var(--color-sf-primary)); }
        .top-strip a :global(.material-symbols-outlined) { font-size: 16px; }

        .form-stage {
          flex: 1; min-height: 0;
          display: flex; align-items: center; justify-content: center;
          padding: 24px 32px 48px;
        }
        .card { width: 100%; max-width: 420px; }

        .welcome-eyebrow {
          font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase;
          color: var(--text-secondary); font-family: var(--font-family-mono);
          margin-bottom: 8px;
        }
        .welcome-title { margin: 0 0 8px; font-size: 28px; font-weight: 500; letter-spacing: -0.3px; }
        .welcome-desc { color: var(--text-secondary); font-size: 14px; line-height: 1.6; margin: 0 0 28px; }

        .field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
        .field label { font-size: 13px; font-weight: 500; display: flex; align-items: center; gap: 4px; }
        .field label .req { color: rgb(var(--color-sf-error)); }
        .field label :global(.help-link) {
          margin-left: auto; font-size: 12px; font-weight: 400;
          color: rgb(var(--color-sf-primary)); text-decoration: none;
        }
        .field label :global(.help-link:hover) { text-decoration: underline; }
        .input-wrap { position: relative; }
        .input-wrap :global(.lead) {
          position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
          color: var(--text-secondary); pointer-events: none;
        }
        .input-wrap :global(.trail) {
          position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
          width: 32px; height: 32px; display: grid; place-items: center;
          color: var(--text-secondary); cursor: pointer; background: transparent; border: 0;
          border-radius: 4px; transition: background 120ms, color 120ms;
        }
        .input-wrap :global(.trail:hover) { background: rgba(15,23,42,.06); color: var(--text-primary); }
        .input-big {
          width: 100%; height: 48px;
          padding: 0 14px 0 42px;
          background: #fff;
          border: 1px solid var(--border-default);
          border-radius: 8px;
          font-family: inherit; font-size: 14.5px; color: var(--text-primary);
          outline: none;
          transition: border-color 150ms, box-shadow 150ms, background 150ms;
        }
        .input-big::placeholder { color: var(--text-placeholder); }
        .input-big:hover { border-color: var(--border-strong); }
        .input-big:focus {
          border-color: rgb(var(--color-sf-primary));
          box-shadow: 0 0 0 4px rgba(40,119,238,.16);
        }

        .opts {
          display: flex; align-items: center; justify-content: space-between;
          margin: 4px 0 20px;
        }
        .check {
          display: inline-flex; align-items: center; gap: 8px;
          font-size: 13px; cursor: pointer; user-select: none;
          background: transparent; border: 0; color: var(--text-primary); padding: 0;
        }
        .check .box {
          width: 18px; height: 18px; border: 1.5px solid var(--border-strong);
          border-radius: 3px; display: inline-grid; place-items: center;
          background: #fff; transition: background 150ms, border-color 150ms;
        }
        .check.on .box { background: rgb(var(--color-sf-primary)); border-color: rgb(var(--color-sf-primary)); }
        .check.on .box::after {
          content: ''; width: 9px; height: 4px;
          border-left: 2px solid #fff; border-bottom: 2px solid #fff;
          transform: translateY(-1px) rotate(-45deg);
        }
        .opts a { font-size: 13px; color: rgb(var(--color-sf-primary)); text-decoration: none; }
        .opts a:hover { text-decoration: underline; }

        .submit-btn {
          width: 100%; height: 48px;
          border: 0; border-radius: 8px;
          background: rgb(var(--color-sf-primary));
          color: #fff;
          font: 500 15px/1 inherit; letter-spacing: .24px;
          cursor: pointer;
          display: inline-flex; align-items: center; justify-content: center; gap: 8px;
          transition: background 150ms, transform 80ms;
        }
        .submit-btn:hover:not(:disabled) { background: rgb(31,87,209); }
        .submit-btn:active { transform: scale(.99); }
        .submit-btn:disabled { opacity: .7; cursor: not-allowed; }
        .submit-btn.loading .spin { display: inline-block; }
        .spin {
          display: none;
          width: 18px; height: 18px;
          border: 2px solid rgba(255,255,255,.4);
          border-top-color: #fff; border-radius: 50%;
          animation: spin 700ms linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        .form-alert {
          display: flex; align-items: flex-start; gap: 10px;
          padding: 12px 14px; border-radius: 8px;
          background: rgb(var(--color-sf-error-container));
          color: rgb(var(--color-sf-on-error-container));
          margin-bottom: 20px;
          font-size: 13px; line-height: 1.5;
          animation: shake .35s ease-out;
        }
        .form-alert :global(.material-symbols-outlined) { font-size: 20px; flex-shrink: 0; color: rgb(var(--color-sf-error)); }
        .form-alert .body .t { font-weight: 600; margin-bottom: 2px; }
        .form-alert .body .msg { color: var(--text-primary); }
        @keyframes shake {
          10%,90%{transform:translateX(-2px)} 20%,80%{transform:translateX(3px)}
          30%,50%,70%{transform:translateX(-5px)} 40%,60%{transform:translateX(5px)}
        }

        .form-foot {
          margin-top: 32px; padding-top: 20px;
          border-top: 1px solid var(--border-default);
          display: flex; align-items: center; justify-content: space-between;
          font-size: 11px; color: var(--text-secondary); font-family: var(--font-family-mono);
        }

        @media (max-width: 880px) {
          .page { grid-template-columns: 1fr !important; }
          .brand-side { display: none; }
        }
      `}</style>
    </div>
  )
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>
}
