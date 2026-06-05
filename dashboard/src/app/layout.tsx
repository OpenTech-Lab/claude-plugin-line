'use client'

import './globals.css'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Geist } from 'next/font/google'
import { cn } from '@/lib/utils'

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' })

function Sidebar() {
  const pathname = usePathname()

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
