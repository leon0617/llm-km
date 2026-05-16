'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { WikiTree as TreeT } from '@/lib/api'

const TYPE_ICONS: Record<string, string> = {
  source: 'description',
  entity: 'apartment',
  concept: 'lightbulb',
  comparison: 'compare_arrows',
  analysis: 'insights',
}

const TYPE_COLORS: Record<string, string> = {
  source: '#1570CD',
  entity: '#7B3FA8',
  concept: 'rgb(18,183,106)',
  comparison: '#B96A02',
  analysis: 'rgb(244,73,62)',
}

export default function WikiTree({ tree }: { tree: TreeT }) {
  const pathname = usePathname()
  const activeName = decodeURIComponent(pathname.replace('/browse/', '').replace(/\/$/, ''))

  function isActive(name: string) {
    return activeName === name
  }

  return (
    <aside className="wiki-tree">
      <div className="tree-section">
        <div className="section-title">特殊頁面</div>
        <div className="tree-list">
          {tree.special.map(p => (
            <Link key={p.name} href={`/browse/${p.name}`}
              className={`tree-item ${isActive(p.name) ? 'active' : ''}`}>
              <span className="material-symbols-outlined">
                {p.name === 'index' ? 'home' : p.name === 'log' ? 'history' : 'help'}
              </span>
              {p.title}
            </Link>
          ))}
        </div>
      </div>

      {tree.groups.filter(g => g.pages.length > 0).map(group => (
        <div key={group.type} className="tree-section">
          <div className="section-title">
            <span className="material-symbols-outlined" style={{ color: TYPE_COLORS[group.type] }}>
              {TYPE_ICONS[group.type]}
            </span>
            {group.label}
            <span className="count">{group.pages.length}</span>
          </div>
          <div className="tree-list">
            {group.pages.map(p => (
              <Link key={p.name} href={`/browse/${p.name}`}
                className={`tree-item ${isActive(p.name) ? 'active' : ''}`}>
                <span className="bullet" style={{ background: TYPE_COLORS[group.type] }} />
                <span className="title">{p.title}</span>
              </Link>
            ))}
          </div>
        </div>
      ))}

      <style>{`
        .wiki-tree {
          width: 280px; flex-shrink: 0;
          border-right: 1px solid var(--border-default);
          overflow-y: auto;
          padding: 12px 0 24px;
          background: #fff;
        }
        .tree-section { margin-bottom: 16px; }
        .section-title {
          padding: 12px 18px 6px;
          font-size: 11px; font-weight: 600;
          color: var(--text-secondary);
          letter-spacing: 0.6px;
          text-transform: uppercase;
          font-family: var(--font-family-mono);
          display: flex; align-items: center; gap: 6px;
        }
        .section-title .material-symbols-outlined { font-size: 14px; }
        .section-title .count {
          margin-left: auto;
          font-size: 11px; padding: 1px 8px; border-radius: 999px;
          background: var(--bg-surface-variant); color: var(--text-secondary);
        }

        .tree-list { display: flex; flex-direction: column; gap: 1px; padding: 0 8px; }

        .tree-item {
          display: flex; align-items: center; gap: 10px;
          padding: 7px 10px; border-radius: 6px;
          color: var(--text-primary); text-decoration: none;
          font-size: 13px;
          transition: background 120ms;
        }
        .tree-item:hover { background: rgba(40,119,238,.06); }
        .tree-item.active {
          background: rgb(var(--color-sf-primary-container));
          color: rgb(var(--color-sf-on-primary-container));
          font-weight: 500;
        }
        .tree-item .material-symbols-outlined {
          font-size: 16px; color: var(--text-secondary);
          flex-shrink: 0;
        }
        .tree-item.active .material-symbols-outlined {
          color: rgb(var(--color-sf-on-primary-container));
        }
        .tree-item .bullet {
          width: 6px; height: 6px; border-radius: 50%;
          flex-shrink: 0;
        }
        .tree-item .title {
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
      `}</style>
    </aside>
  )
}
