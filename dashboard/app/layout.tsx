'use client'

import './globals.css'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Geist } from 'next/font/google'
import { cn } from '@/lib/utils'

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' })

function usePendingCount() {
  const [count, setCount] = useState(0)
  useEffect(() => {
    const load = () =>
      fetch('/api/pending')
        .then(r => r.json())
        .then(rows => setCount(Array.isArray(rows) ? rows.length : 0))
        .catch(() => {})
    load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [])
  return count
}

function Sidebar() {
  const pathname = usePathname()
  const pendingCount = usePendingCount()

  function isActive(href: string) {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  const navLinks = [
    { href: '/', label: 'Overview' },
    { href: '/tenants', label: 'Tenants' },
    { href: '/activity', label: 'Activity' },
  ]

  return (
    <aside className="fixed left-0 top-0 w-56 h-screen bg-slate-900 text-slate-100 flex flex-col z-50">
      <div className="text-lg font-semibold p-4 border-b border-slate-700">
        LINE Bot Admin
      </div>
      <nav className="flex-1 py-2">
        {navLinks.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 text-sm rounded-md mx-2 my-0.5 hover:bg-slate-700 transition-colors text-slate-300',
              isActive(href) && 'bg-slate-700 text-white font-medium'
            )}
          >
            {label}
          </Link>
        ))}
        <Link
          href="/pending"
          className={cn(
            'flex items-center justify-between px-4 py-2.5 text-sm rounded-md mx-2 my-0.5 hover:bg-slate-700 transition-colors text-slate-300',
            isActive('/pending') && 'bg-slate-700 text-white font-medium'
          )}
        >
          <span>Pending</span>
          {pendingCount > 0 && (
            <span className="ml-auto bg-red-500 text-white text-xs font-medium px-1.5 py-0.5 rounded-full">
              {pendingCount}
            </span>
          )}
        </Link>
      </nav>
    </aside>
  )
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn('font-sans', geist.variable)}>
      <head>
        <title>LINE Bot Admin</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>
        <Sidebar />
        <main className="ml-56 min-h-screen bg-slate-50">{children}</main>
      </body>
    </html>
  )
}
