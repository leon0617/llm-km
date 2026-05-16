'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import AppShell from '@/components/AppShell'
import WikiRenderer from '@/components/WikiRenderer'

interface ToolEvent { tool: string; page?: string; keyword?: string }
interface Message {
  role: 'user' | 'assistant'
  text: string
  toolEvents: ToolEvent[]
  citations: string[]
  loading?: boolean
  tokens_in?: number
  tokens_out?: number
  cost_usd?: number
  provider?: string
  tier?: string
}
interface SessionSummary {
  id: string
  title: string
  created_at: string
  updated_at: string
  message_count: number
}

const SUGGESTIONS = [
  '這份文件的重點是什麼？',
  '有哪些相關的概念頁面？',
  '幫我整理這個主題的重要知識',
  '這個指標的判斷條件是什麼？',
]

function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  return (n / 1000).toFixed(n < 10000 ? 2 : 1) + 'k'
}

function timeAgo(iso: string): string {
  const d = new Date(iso); const now = new Date()
  const diff = (now.getTime() - d.getTime()) / 1000
  if (diff < 60) return `${Math.floor(diff)} 秒前`
  if (diff < 3600) return `${Math.floor(diff / 60)} 分前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小時前`
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} 天前`
  return d.toISOString().slice(0, 10)
}

export default function QueryPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [todayUsage, setTodayUsage] = useState<{ tokens_in: number; tokens_out: number; cost_usd: number } | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const fetchSessions = useCallback(async () => {
    const r = await fetch('/api/query/sessions')
    if (r.ok) {
      const d = await r.json()
      setSessions(d.sessions || [])
    }
  }, [])

  const fetchUsage = useCallback(async () => {
    const r = await fetch('/api/query/usage/today')
    if (r.ok) setTodayUsage(await r.json())
  }, [])

  useEffect(() => { fetchSessions(); fetchUsage() }, [fetchSessions, fetchUsage])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function loadSession(id: string) {
    if (busy) return
    setCurrentSessionId(id)
    const r = await fetch(`/api/query/sessions/${id}`)
    if (!r.ok) return
    const d = await r.json()
    const msgs: Message[] = (d.messages || []).map((m: {
      role: 'user' | 'assistant'
      text: string
      tool_events?: ToolEvent[]
      citations?: string[]
      tokens_in?: number
      tokens_out?: number
    }) => ({
      role: m.role,
      text: m.text,
      toolEvents: m.tool_events || [],
      citations: m.citations || [],
      tokens_in: m.tokens_in,
      tokens_out: m.tokens_out,
    }))
    setMessages(msgs)
  }

  function newChat() {
    setMessages([])
    setCurrentSessionId(null)
  }

  async function deleteSession(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm('確定要刪除這個對話？')) return
    const r = await fetch(`/api/query/sessions/${id}`, { method: 'DELETE' })
    if (r.ok) {
      if (currentSessionId === id) newChat()
      fetchSessions()
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const q = input.trim()
    if (!q || busy) return
    setInput(''); setBusy(true)

    const userMsg: Message = { role: 'user', text: q, toolEvents: [], citations: [] }
    const assistantMsg: Message = { role: 'assistant', text: '', toolEvents: [], citations: [], loading: true }
    setMessages(prev => [...prev, userMsg, assistantMsg])

    try {
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, session_id: currentSessionId }),
      })
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop() || ''
        for (const part of parts) {
          const lines = part.split('\n')
          let event = '', data = ''
          for (const line of lines) {
            if (line.startsWith('event: ')) event = line.slice(7)
            if (line.startsWith('data: ')) data = line.slice(6)
          }
          if (!event || !data) continue
          try {
            const payload = JSON.parse(data)
            if (event === 'session') {
              if (!currentSessionId) setCurrentSessionId(payload.id)
              continue
            }
            setMessages(prev => {
              const msgs = [...prev]
              const last = { ...msgs[msgs.length - 1] }
              if (event === 'text') last.text += payload.delta
              if (event === 'tool_use') last.toolEvents = [...last.toolEvents, payload]
              if (event === 'citations') last.citations = payload.pages
              if (event === 'provider') {
                last.provider = payload.name
                if (payload.tier) last.tier = payload.tier
              }
              if (event === 'usage') {
                last.tokens_in = payload.tokens_in
                last.tokens_out = payload.tokens_out
                last.cost_usd = payload.cost_usd
                if (payload.provider) last.provider = payload.provider
                if (payload.tier) last.tier = payload.tier
              }
              if (event === 'done') last.loading = false
              if (event === 'error') { last.text = `錯誤：${payload.message}`; last.loading = false }
              msgs[msgs.length - 1] = last
              return msgs
            })
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      setMessages(prev => {
        const msgs = [...prev]
        msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], text: `連線失敗：${err}`, loading: false }
        return msgs
      })
    } finally {
      setBusy(false)
      fetchSessions()
      fetchUsage()
    }
  }

  return (
    <AppShell crumbs={[{ label: '聊天查詢' }]}>
      <div className="query-layout">
        {/* Session drawer */}
        <aside className="session-drawer">
          <div className="drawer-head">
            <button className="new-chat-btn" onClick={newChat}>
              <span className="material-symbols-outlined">add</span>新對話
            </button>
          </div>
          <div className="session-list">
            {sessions.length === 0 ? (
              <div className="empty-sessions">
                <span className="material-symbols-outlined">forum</span>
                <p>還沒有對話</p>
              </div>
            ) : (
              sessions.map(s => (
                <button key={s.id}
                  className={`session-item ${currentSessionId === s.id ? 'active' : ''}`}
                  onClick={() => loadSession(s.id)}
                  disabled={busy}>
                  <span className="material-symbols-outlined">chat</span>
                  <div className="info">
                    <div className="title">{s.title || '（無標題）'}</div>
                    <div className="meta">{s.message_count} 則 · {timeAgo(s.updated_at)}</div>
                  </div>
                  <button className="del-btn" onClick={e => deleteSession(s.id, e)} title="刪除對話">
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </button>
              ))
            )}
          </div>
          {todayUsage && (
            <div className="drawer-foot">
              <div className="usage-card">
                <div className="label">今日用量</div>
                <div className="row">
                  <span>輸入</span><b>{formatTokens(todayUsage.tokens_in)}</b>
                </div>
                <div className="row">
                  <span>輸出</span><b>{formatTokens(todayUsage.tokens_out)}</b>
                </div>
                <div className="row total">
                  <span>成本</span><b>${todayUsage.cost_usd.toFixed(4)}</b>
                </div>
              </div>
            </div>
          )}
        </aside>

        {/* Chat panel */}
        <section className="chat-panel">
          <div className="chat-area">
            {messages.length === 0 ? (
              <div className="empty-state">
                <span className="material-symbols-outlined ic" style={{ fontSize: 64, opacity: .4 }}>forum</span>
                <p style={{ fontSize: 17, color: 'var(--text-primary)', margin: '12px 0 4px', fontWeight: 500 }}>開始查詢知識庫</p>
                <p style={{ fontSize: 13, margin: 0 }}>用繁體中文直接問問題，LLM 會自動翻找相關 wiki 頁面</p>
                <div className="suggestions">
                  {SUGGESTIONS.map(s => (
                    <button key={s} className="sug" onClick={() => setInput(s)}>{s}</button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg, i) => (
                  <div key={i} className={`msg-row ${msg.role}`}>
                    {msg.role === 'assistant' && (
                      <div className="avatar">KM</div>
                    )}
                    <div className={`msg-bubble ${msg.role}`}>
                      {msg.role === 'user' ? (
                        <span>{msg.text}</span>
                      ) : (
                        <>
                          {msg.toolEvents.length > 0 && (
                            <div className="tool-events">
                              {msg.toolEvents.map((ev, j) => (
                                <div key={j} className="tool-event">
                                  <span className="material-symbols-outlined">
                                    {ev.tool === 'read_page' ? 'article' : ev.tool === 'search_pages' ? 'search' : 'list'}
                                  </span>
                                  {ev.tool === 'read_page' && <>正在讀取 <span className="ref">[[{ev.page}]]</span></>}
                                  {ev.tool === 'search_pages' && <>搜尋「{ev.keyword}」</>}
                                  {ev.tool === 'list_pages' && <>列出所有頁面</>}
                                </div>
                              ))}
                            </div>
                          )}

                          {msg.loading && !msg.text ? (
                            <div className="thinking">
                              <div className="dots">
                                {[0,1,2].map(n => <span key={n} className="dot" style={{ animationDelay: `${n*0.15}s` }} />)}
                              </div>
                              思考中…
                            </div>
                          ) : (
                            <WikiRenderer content={msg.text} />
                          )}

                          {msg.citations.length > 0 && (
                            <div className="citations">
                              {msg.citations.map(p => (
                                <a key={p} href={`/browse/${p}`} className="citation-chip">
                                  <span className="material-symbols-outlined">article</span>
                                  {p}
                                </a>
                              ))}
                            </div>
                          )}

                          {(msg.tokens_in !== undefined || msg.tokens_out !== undefined || msg.provider) && !msg.loading && (
                            <div className="tokens">
                              {msg.provider && (
                                <>
                                  <span className={`provider-badge prov-${msg.provider}`}>{msg.provider}</span>
                                  {msg.tier && (
                                    <span className={`tier-badge tier-${msg.tier}`}>{msg.tier}</span>
                                  )}
                                  <span className="sep">·</span>
                                </>
                              )}
                              <span className="material-symbols-outlined">bolt</span>
                              <span>↑ {formatTokens(msg.tokens_in || 0)}</span>
                              <span className="sep">·</span>
                              <span>↓ {formatTokens(msg.tokens_out || 0)}</span>
                              {msg.cost_usd !== undefined && (
                                <>
                                  <span className="sep">·</span>
                                  <span>${msg.cost_usd.toFixed(5)}</span>
                                </>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </>
            )}
          </div>

          <form onSubmit={submit} className="input-bar">
            <input value={input} onChange={e => setInput(e.target.value)}
              placeholder={currentSessionId ? "繼續對話…" : "輸入問題，例如：這個指標的判斷條件是什麼？"}
              disabled={busy}
              className="chat-input" />
            <button type="submit" disabled={busy || !input.trim()} className="btn btn-primary">
              <span className="material-symbols-outlined">send</span>
              送出
            </button>
          </form>
        </section>
      </div>

      <style jsx>{`
        .query-layout { flex: 1; display: flex; min-height: 0; }

        .session-drawer {
          width: 260px; flex-shrink: 0;
          border-right: 1px solid var(--border-default);
          display: flex; flex-direction: column;
          background: #fff;
        }
        .drawer-head { padding: 12px; border-bottom: 1px solid var(--border-default); }
        .new-chat-btn {
          width: 100%; height: 40px;
          display: inline-flex; align-items: center; justify-content: center; gap: 6px;
          background: rgb(var(--color-sf-primary)); color: #fff;
          border: 0; border-radius: 8px;
          font: 500 14px/1 inherit; cursor: pointer;
          transition: background 120ms;
        }
        .new-chat-btn:hover { background: rgb(31,87,209); }
        .new-chat-btn :global(.material-symbols-outlined) { font-size: 18px; }

        .session-list { flex: 1; overflow-y: auto; padding: 6px; }
        .empty-sessions {
          margin: 40px auto; text-align: center;
          color: var(--text-secondary); font-size: 12.5px;
        }
        .empty-sessions :global(.material-symbols-outlined) {
          font-size: 32px; opacity: .4; display: block; margin-bottom: 6px;
        }

        .session-item {
          display: flex; align-items: center; gap: 8px;
          width: 100%; padding: 8px 10px; border-radius: 6px;
          background: transparent; border: 0; cursor: pointer;
          color: var(--text-primary); font: inherit; text-align: left;
          transition: background 120ms;
          position: relative;
        }
        .session-item:hover:not(:disabled) { background: rgba(40,119,238,.06); }
        .session-item.active {
          background: rgb(var(--color-sf-primary-container));
          color: rgb(var(--color-sf-on-primary-container));
          font-weight: 500;
        }
        .session-item :global(.material-symbols-outlined) {
          font-size: 18px; color: var(--text-secondary); flex-shrink: 0;
        }
        .session-item .info { flex: 1; min-width: 0; }
        .session-item .title {
          font-size: 13px;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .session-item .meta {
          font-size: 11px; color: var(--text-secondary); margin-top: 2px;
          font-family: var(--font-family-mono);
        }
        .del-btn {
          width: 22px; height: 22px; flex-shrink: 0;
          background: transparent; border: 0; cursor: pointer;
          display: grid; place-items: center;
          color: var(--text-secondary); border-radius: 4px;
          opacity: 0; transition: all 120ms;
        }
        .session-item:hover .del-btn { opacity: 1; }
        .del-btn:hover {
          background: rgba(244,73,62,.12); color: rgb(var(--color-sf-error));
        }
        .del-btn :global(.material-symbols-outlined) { font-size: 14px; color: inherit; }

        .drawer-foot { padding: 12px; border-top: 1px solid var(--border-default); }
        .usage-card {
          background: var(--bg-surface-variant);
          padding: 12px;
          border-radius: 8px;
          font-size: 12px;
        }
        .usage-card .label {
          font-size: 10px; letter-spacing: 1.2px; text-transform: uppercase;
          color: var(--text-secondary); font-family: var(--font-family-mono);
          margin-bottom: 8px;
        }
        .usage-card .row {
          display: flex; justify-content: space-between;
          padding: 2px 0;
        }
        .usage-card .row b {
          font-variant-numeric: tabular-nums;
          font-family: var(--font-family-mono);
        }
        .usage-card .row.total {
          margin-top: 4px; padding-top: 6px;
          border-top: 1px solid var(--border-default);
          color: rgb(var(--color-sf-primary)); font-weight: 600;
        }

        .chat-panel { flex: 1; display: flex; flex-direction: column; min-width: 0; }

        .chat-area {
          flex: 1; overflow-y: auto;
          padding: 24px 28px;
          display: flex; flex-direction: column; gap: 24px;
        }

        .empty-state {
          margin: auto; text-align: center; color: var(--text-secondary);
          padding: 40px 20px;
        }
        .suggestions {
          margin-top: 24px;
          display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
          max-width: 520px;
        }
        .sug {
          text-align: left; padding: 10px 14px;
          background: #fff; border: 1px solid var(--border-default);
          border-radius: 8px; font-size: 13px; color: var(--text-primary);
          cursor: pointer; font-family: inherit;
          transition: all 120ms;
        }
        .sug:hover { border-color: rgb(var(--color-sf-primary)); background: rgba(40,119,238,.04); }

        .msg-row { display: flex; gap: 12px; }
        .msg-row.user { justify-content: flex-end; }

        .avatar {
          width: 32px; height: 32px; border-radius: 8px;
          background: rgb(var(--color-sf-on-primary-container));
          color: #fff; display: grid; place-items: center;
          font-size: 12px; font-weight: 700;
          flex-shrink: 0;
        }

        .msg-bubble.user {
          max-width: 70%;
          background: rgb(var(--color-sf-primary));
          color: #fff;
          border-radius: 16px 16px 4px 16px;
          padding: 10px 14px;
          font-size: 14px;
          line-height: 1.6;
        }
        .msg-bubble.assistant {
          flex: 1; min-width: 0; max-width: calc(100% - 44px);
        }

        .tool-events { margin-bottom: 12px; display: flex; flex-direction: column; gap: 4px; }
        .tool-event {
          display: inline-flex; align-items: center; gap: 6px;
          font-size: 12px; color: var(--text-secondary);
          font-family: var(--font-family-mono);
        }
        .tool-event :global(.material-symbols-outlined) { font-size: 14px; color: rgb(var(--color-sf-primary)); }
        .tool-event .ref { color: rgb(var(--color-sf-primary)); }

        .thinking { display: flex; align-items: center; gap: 8px; color: var(--text-secondary); font-size: 13px; }
        .dots { display: flex; gap: 4px; }
        .dot {
          width: 6px; height: 6px; border-radius: 50%; background: var(--text-secondary);
          animation: bounce 1.2s infinite ease-in-out;
        }
        @keyframes bounce {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }

        .citations { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 6px; }
        .citation-chip {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 3px 10px; border-radius: 999px;
          background: rgb(var(--color-sf-primary-container));
          color: rgb(var(--color-sf-on-primary-container));
          font-size: 11px; font-weight: 500;
          text-decoration: none; transition: opacity 120ms;
        }
        .citation-chip:hover { opacity: 0.8; }
        .citation-chip :global(.material-symbols-outlined) { font-size: 12px; }

        .tokens {
          margin-top: 8px;
          display: inline-flex; align-items: center; gap: 6px;
          font-size: 11px; color: var(--text-secondary);
          font-family: var(--font-family-mono);
          padding: 2px 8px;
          background: var(--bg-surface-variant);
          border-radius: 4px;
        }
        .tokens :global(.material-symbols-outlined) {
          font-size: 12px; color: rgb(247,144,9);
        }
        .tokens .sep { opacity: .5; }
        .provider-badge {
          padding: 1px 6px; border-radius: 3px;
          font-size: 10px; font-weight: 600; text-transform: uppercase;
          letter-spacing: 0.4px;
        }
        :global(.prov-anthropic) { background: rgba(204,108,77,.16); color: #B85C2E; }
        :global(.prov-openai)    { background: rgba(16,163,127,.16); color: #0d8e6c; }
        :global(.prov-gemini)    { background: rgba(66,133,244,.16); color: #1a73e8; }
        .tier-badge {
          padding: 1px 6px; border-radius: 3px;
          font-size: 10px; font-weight: 600; text-transform: uppercase;
          letter-spacing: 0.4px;
        }
        :global(.tier-cheap)   { background: rgba(108,117,125,.16); color: #5a6268; }
        :global(.tier-premium) { background: rgba(124,77,255,.16); color: #6a3fc4; }

        .input-bar {
          padding: 16px 20px; border-top: 1px solid var(--border-default);
          display: flex; gap: 8px; background: #fff;
        }
        .chat-input {
          flex: 1; height: 44px; padding: 0 16px;
          border: 1px solid var(--border-default);
          border-radius: 12px;
          font-family: inherit; font-size: 14px;
          color: var(--text-primary);
          outline: none;
          transition: border-color 120ms, box-shadow 120ms;
        }
        .chat-input:focus {
          border-color: rgb(var(--color-sf-primary));
          box-shadow: 0 0 0 4px rgba(40,119,238,.16);
        }
        .chat-input:disabled { opacity: .5; }
        .input-bar :global(.btn) { height: 44px; padding: 0 20px; border-radius: 12px; }
      `}</style>
    </AppShell>
  )
}
