'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { WikiTree } from '@/lib/api'

const TYPE_ICONS: Record<string, string> = {
  source: 'description',
  entity: 'apartment',
  concept: 'lightbulb',
  comparison: 'compare',
  analysis: 'analytics',
  special: 'star',
}

interface Props {
  tree: WikiTree
}

export default function Sidebar({ tree }: Props) {
  const pathname = usePathname()

  function isActive(name: string) {
    return pathname === `/browse/${name}`
  }

  return (
    <aside className="w-[248px] flex-shrink-0 bg-white border border-outline-variant rounded-xl flex flex-col overflow-hidden">
      {/* Special pages */}
      <div className="px-2 pt-3 pb-1">
        <div className="px-3 pb-2 text-[10px] tracking-[1.4px] uppercase text-on-surface-variant font-semibold font-mono">
          導航
        </div>
        <div className="flex flex-col gap-0.5">
          {[
            { name: 'index', label: '索引', icon: 'table_of_contents' },
            { name: 'log', label: '操作日誌', icon: 'history' },
            { name: 'questions', label: '開放問題', icon: 'help_outline' },
          ].map(({ name, label, icon }) => (
            <Link
              key={name}
              href={`/browse/${name}`}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-[13.5px] transition-colors ${
                isActive(name)
                  ? 'bg-primary-container text-on-primary-container font-medium'
                  : 'text-on-surface hover:bg-primary/[0.06]'
              }`}
            >
              <span className={`material-symbols-outlined text-[20px] ${isActive(name) ? 'text-on-primary-container' : 'text-on-surface-variant'}`}
                style={isActive(name) ? { fontVariationSettings: "'FILL' 1" } : {}}>
                {icon}
              </span>
              {label}
            </Link>
          ))}
        </div>
      </div>

      <div className="h-px bg-outline-variant mx-3.5 my-2" />

      {/* Content groups */}
      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-1">
        {tree.groups.map(group => (
          group.pages.length > 0 && (
            <div key={group.type}>
              <div className="flex items-center justify-between px-3 pt-3 pb-1">
                <span className="text-[10px] tracking-[1.4px] uppercase text-on-surface-variant font-semibold font-mono">
                  {group.label}
                </span>
                <span className="text-[11px] font-mono text-on-surface-variant bg-surface-variant px-2 py-0.5 rounded-full">
                  {group.pages.length}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                {group.pages.map(page => (
                  <Link
                    key={page.name}
                    href={`/browse/${page.name}`}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-[13.5px] transition-colors ${
                      isActive(page.name)
                        ? 'bg-primary-container text-on-primary-container font-medium'
                        : 'text-on-surface hover:bg-primary/[0.06]'
                    }`}
                  >
                    <span
                      className={`material-symbols-outlined text-[20px] flex-shrink-0 ${isActive(page.name) ? 'text-on-primary-container' : 'text-on-surface-variant'}`}
                      style={isActive(page.name) ? { fontVariationSettings: "'FILL' 1" } : {}}
                    >
                      {TYPE_ICONS[group.type] || 'article'}
                    </span>
                    <span className="truncate">{page.title}</span>
                  </Link>
                ))}
              </div>
            </div>
          )
        ))}
      </div>
    </aside>
  )
}
