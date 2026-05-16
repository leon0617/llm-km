import { notFound } from 'next/navigation'
import { api } from '@/lib/api'
import AppShell from '@/components/AppShell'
import WikiTree from '@/components/WikiTree'
import WikiRenderer from '@/components/WikiRenderer'
import WikiPageActions from '@/components/WikiPageActions'

interface Props { params: { slug: string[] } }

const TYPE_LABELS: Record<string, string> = {
  source: '來源摘要',
  entity: '實體',
  concept: '概念',
  comparison: '比較',
  analysis: '分析',
}

const TYPE_CHIP_CLASS: Record<string, string> = {
  source: 'type-source',
  entity: 'type-entity',
  concept: 'type-concept',
  comparison: 'type-comparison',
  analysis: 'type-analysis',
}

export default async function WikiPage({ params }: Props) {
  const name = params.slug.map(s => decodeURIComponent(s)).join('/')
  const [tree, page] = await Promise.all([
    api.tree().catch(() => ({ groups: [], special: [], other: [] })),
    api.page(name).catch(() => null),
  ])

  if (!page) notFound()

  const fm = page.frontmatter as Record<string, unknown>
  const tags = (fm.tags as string[]) || []
  const sources = (fm.sources as string[]) || []
  const updated = (fm.updated as string) || ''
  const created = (fm.created as string) || ''
  const type = (fm.type as string) || 'wiki'
  const title = (fm.title as string) || name

  return (
    <AppShell crumbs={[
      { label: 'Wiki 瀏覽', href: '/browse' },
      { label: title },
    ]}>
      <div className="browse-layout">
        <WikiTree tree={tree} />

        <article className="article">
          <WikiPageActions name={name} initialMarkdown={page.raw_markdown}>
          <div className="article-head">
            <div className="meta-row">
              <span className={`type-chip ${TYPE_CHIP_CLASS[type] || ''}`}>
                {TYPE_LABELS[type] || type.toUpperCase()}
              </span>
              {created && <span className="meta-text">建立 {created}</span>}
              {updated && <span className="meta-text">更新 {updated}</span>}
            </div>
            <h1>{title}</h1>
            {tags.length > 0 && (
              <div className="tag-list">
                {tags.map(tag => <span key={tag} className="tag">#{tag}</span>)}
              </div>
            )}
          </div>

          <div className="article-body">
            <div className="wiki-body">
              <WikiRenderer content={page.body_markdown} />
            </div>

            {(page.backlinks.length > 0 || sources.length > 0) && (
              <aside className="side-panel">
                {page.backlinks.length > 0 && (
                  <div className="panel-card">
                    <div className="panel-title">
                      <span className="material-symbols-outlined">link</span>
                      反向連結
                      <span className="count">{page.backlinks.length}</span>
                    </div>
                    <div className="panel-list">
                      {page.backlinks.map(bl => (
                        <a key={bl.name} href={`/browse/${bl.name}`} className="panel-item">
                          {bl.title}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
                {sources.length > 0 && (
                  <div className="panel-card">
                    <div className="panel-title">
                      <span className="material-symbols-outlined">attachment</span>
                      原始來源
                    </div>
                    <div className="panel-list">
                      {sources.map((src: string) => {
                        const rawFile = page.raw_files.find(f => f.name === src)
                        return rawFile ? (
                          <a key={src} href={rawFile.url} className="panel-item" target="_blank" rel="noopener noreferrer">
                            <span className="material-symbols-outlined">download</span>
                            {src}
                          </a>
                        ) : (
                          <span key={src} className="panel-item disabled">{src}</span>
                        )
                      })}
                    </div>
                  </div>
                )}
              </aside>
            )}
          </div>
          </WikiPageActions>
        </article>
      </div>

      <style>{`
        .browse-layout { flex: 1; display: flex; min-height: 0; }
        .article { flex: 1; min-width: 0; overflow-y: auto; }
        .article-head {
          padding: 28px 32px 20px;
          border-bottom: 1px solid var(--border-default);
        }
        .meta-row { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
        .meta-text {
          font-size: 12px; color: var(--text-secondary);
          font-family: var(--font-family-mono);
        }
        .article-head h1 {
          margin: 0; font-size: 28px; font-weight: 500; letter-spacing: -0.3px;
          line-height: 1.3;
        }
        .tag-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
        .tag {
          padding: 2px 8px; border-radius: 4px;
          background: var(--bg-surface-variant); color: var(--text-secondary);
          font-size: 11px; font-family: var(--font-family-mono);
        }

        .article-body {
          padding: 28px 32px;
          display: grid; grid-template-columns: 1fr 240px; gap: 32px;
          align-items: start;
        }
        .article-body :global(.wiki-body) { min-width: 0; line-height: 1.7; font-size: 14.5px; }

        .side-panel { display: flex; flex-direction: column; gap: 12px; position: sticky; top: 0; }
        .panel-card {
          background: #fff;
          border: 1px solid var(--border-default);
          border-radius: 8px;
          overflow: hidden;
        }
        .panel-title {
          padding: 10px 14px;
          background: var(--bg-surface-variant);
          font-size: 11px; font-weight: 600;
          letter-spacing: 0.4px; text-transform: uppercase;
          color: var(--text-secondary); font-family: var(--font-family-mono);
          display: flex; align-items: center; gap: 6px;
          border-bottom: 1px solid var(--border-default);
        }
        .panel-title :global(.material-symbols-outlined) { font-size: 14px; }
        .panel-title .count {
          margin-left: auto; font-size: 10px;
          padding: 1px 6px; border-radius: 999px;
          background: #fff; color: var(--text-secondary);
        }
        .panel-list { padding: 6px; }
        .panel-item {
          display: flex; align-items: center; gap: 6px;
          padding: 6px 10px; border-radius: 4px;
          color: rgb(var(--color-sf-primary)); text-decoration: none;
          font-size: 12.5px;
          transition: background 120ms;
        }
        .panel-item:hover { background: rgba(40,119,238,.06); }
        .panel-item :global(.material-symbols-outlined) { font-size: 13px; }
        .panel-item.disabled { color: var(--text-secondary); cursor: default; }

        @media (max-width: 1100px) {
          .article-body { grid-template-columns: 1fr; }
          .side-panel { position: static; }
        }
      `}</style>
    </AppShell>
  )
}
