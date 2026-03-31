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
    icon: '/favicon.png',
  }
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
