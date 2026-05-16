import { api } from '@/lib/api'
import Link from 'next/link'
import AppShell from '@/components/AppShell'
import WikiTree from '@/components/WikiTree'

interface Props {
  searchParams: { q?: string }
}

export default async function BrowsePage({ searchParams }: Props) {
  const q = (searchParams.q || '').trim()

  const [tree, results] = await Promise.all([
    api.tree().catch(() => ({ groups: [], special: [], other: [] })),
    q.length >= 2
      ? api.search(q).catch(() => ({ matches: [] }))
      : Promise.resolve({ matches: [] }),
  ])

  return (
    <AppShell crumbs={q
      ? [{ label: 'Wiki 瀏覽', href: '/browse' }, { label: `搜尋「${q}」` }]
      : [{ label: 'Wiki 瀏覽' }]
    }>
      <div className="browse-layout">
        <WikiTree tree={tree} />

        {q.length >= 2 ? (
          <section className="search-results">
            <div className="search-head">
              <h1>搜尋結果</h1>
              <p className="meta">
                關鍵字 <code>{q}</code> · 找到 <b>{results.matches.length}</b> 個頁面
              </p>
            </div>

            {results.matches.length === 0 ? (
              <div className="empty">
                <span className="material-symbols-outlined">search_off</span>
                <p className="title">沒有符合的頁面</p>
                <p className="hint">試試其他關鍵字，或從左側選擇頁面瀏覽</p>
              </div>
            ) : (
              <ul className="result-list">
                {results.matches.map(m => (
                  <li key={m.name}>
                    <Link href={`/browse/${m.name}`} className="result-item">
                      <span className="material-symbols-outlined ic">article</span>
                      <div className="content">
                        <div className="title">{m.title}</div>
                        <div className="snippet">{highlightSnippet(m.snippet, q)}</div>
                        <div className="filename">{m.name}.md</div>
                      </div>
                      <span className="material-symbols-outlined arrow">arrow_forward</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : (
          <section className="browse-empty">
            <span className="material-symbols-outlined">menu_book</span>
            <p className="title">選擇一個 Wiki 頁面</p>
            <p className="hint">從左側列表選擇頁面，或用頂部搜尋列查詢</p>
          </section>
        )}
      </div>

      <style>{`
        .browse-layout { flex: 1; display: flex; min-height: 0; }
        .browse-empty {
          flex: 1; min-width: 0;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          color: var(--text-secondary); padding: 40px;
        }
        .browse-empty .material-symbols-outlined {
          font-size: 64px; color: var(--border-strong); margin-bottom: 16px;
        }
        .browse-empty .title {
          font-size: 17px; color: var(--text-primary); margin: 0 0 4px; font-weight: 500;
        }
        .browse-empty .hint { font-size: 13px; margin: 0; }

        .search-results {
          flex: 1; min-width: 0; overflow-y: auto;
          padding: 28px 32px;
        }
        .search-head { margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--border-default); }
        .search-head h1 { margin: 0 0 4px; font-size: 22px; font-weight: 500; }
        .search-head .meta { margin: 0; font-size: 13px; color: var(--text-secondary); }
        .search-head .meta code {
          font-family: var(--font-family-mono); font-size: 12px;
          background: var(--bg-surface-variant); padding: 2px 6px; border-radius: 3px;
        }

        .empty {
          margin: 40px auto; text-align: center;
          color: var(--text-secondary); max-width: 400px;
        }
        .empty .material-symbols-outlined { font-size: 48px; opacity: .4; }
        .empty .title { color: var(--text-primary); font-size: 15px; font-weight: 500; margin: 8px 0 4px; }
        .empty .hint { font-size: 13px; margin: 0; }

        .result-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
        .result-item {
          display: flex; align-items: center; gap: 14px;
          padding: 14px 16px; border-radius: 10px;
          background: #fff; border: 1px solid var(--border-default);
          color: var(--text-primary); text-decoration: none;
          transition: all 120ms;
        }
        .result-item:hover {
          border-color: rgb(var(--color-sf-primary));
          background: rgba(40,119,238,.03);
        }
        .result-item .ic {
          font-size: 22px; color: rgb(var(--color-sf-primary));
          flex-shrink: 0;
        }
        .result-item .content { flex: 1; min-width: 0; }
        .result-item .title { font-weight: 500; font-size: 14.5px; margin-bottom: 4px; }
        .result-item .snippet {
          font-size: 12.5px; color: var(--text-secondary);
          line-height: 1.5; margin-bottom: 4px;
          overflow: hidden; text-overflow: ellipsis;
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
        }
        .result-item .snippet :global(mark) {
          background: rgba(247,144,9,.25);
          color: var(--text-primary);
          padding: 0 2px; border-radius: 2px;
        }
        .result-item .filename {
          font-size: 11px; color: var(--text-secondary);
          font-family: var(--font-family-mono);
        }
        .result-item .arrow {
          font-size: 18px; color: var(--text-secondary);
          flex-shrink: 0;
        }
        .result-item:hover .arrow { color: rgb(var(--color-sf-primary)); }
      `}</style>
    </AppShell>
  )
}

// Wrap matched substring with <mark>...</mark>
function highlightSnippet(snippet: string, q: string) {
  const idx = snippet.toLowerCase().indexOf(q.toLowerCase())
  if (idx === -1) return snippet
  return (
    <>
      {snippet.slice(0, idx)}
      <mark>{snippet.slice(idx, idx + q.length)}</mark>
      {snippet.slice(idx + q.length)}
    </>
  )
}
