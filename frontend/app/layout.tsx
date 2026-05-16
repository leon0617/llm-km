import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
title: 'LLM Wiki',
description: '內部知識庫',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <head>
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,400,0,0" />
      </head>
      <body>{children}</body>
    </html>
  )
}
