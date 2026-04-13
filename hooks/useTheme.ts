'use client'
import { useState, useEffect } from 'react'

type Theme = 'dark' | 'light'

export function useTheme() {
  const [theme, setTheme] = useState<Theme>('dark')

  useEffect(() => {
    const stored = localStorage.getItem('kairos-theme') as Theme | null
    if (stored === 'light' || stored === 'dark') {
      setTheme(stored)
      document.documentElement.setAttribute('data-theme', stored)
    }
  }, [])

  function toggleTheme() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    localStorage.setItem('kairos-theme', next)
    document.documentElement.setAttribute('data-theme', next)
  }

  return { theme, toggleTheme }
}
