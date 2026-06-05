'use client'

import './globals.css'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

function Sidebar() {
  const pathname = usePathname()

  function isActive(href: string) {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-title">LINE Bot Admin</div>
      <ul className="sidebar-nav">
        <li>
          <Link href="/" className={isActive('/') ? 'active' : ''}>
            Overview
          </Link>
        </li>
        <li>
          <Link href="/tenants" className={isActive('/tenants') ? 'active' : ''}>
            Tenants
          </Link>
        </li>
        <li>
          <Link href="/activity" className={isActive('/activity') ? 'active' : ''}>
            Activity
          </Link>
        </li>
      </ul>
    </aside>
  )
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <title>LINE Bot Admin</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>
        <Sidebar />
        <main className="main-content">{children}</main>
      </body>
    </html>
  )
}
