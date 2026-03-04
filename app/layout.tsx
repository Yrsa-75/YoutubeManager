import type { Metadata } from 'next'
import { DM_Sans } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'
import { Toaster } from 'react-hot-toast'

const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-dm-sans' })

export const metadata: Metadata = {
  title: 'YoutubeManager',
  description: 'Gérez votre catalogue YouTube comme un pro',
  icons: {
    icon: [
      { url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="%23e63946"/><polygon points="13,10 13,22 23,16" fill="white"/></svg>' }
    ]
  }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={dmSans.variable}>
      <body>
        <Providers>{children}</Providers>
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: { background: '#14141e', color: '#f0f0f6', border: '1px solid #22222e', fontSize: '13px' },
            success: { iconTheme: { primary: '#22c55e', secondary: '#14141e' } },
            error: { iconTheme: { primary: '#ef4444', secondary: '#14141e' } },
          }}
        />
      </body>
    </html>
  )
}
