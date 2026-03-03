/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'bg-primary': '#09090f',
        'bg-secondary': '#0f0f18',
        'bg-card': '#14141e',
        'bg-hover': '#1a1a26',
        'bg-border': '#22222e',
        'accent-red': '#e63946',
        'text-primary': '#f0f0f6',
        'text-secondary': '#8888a0',
        'text-muted': '#55556a',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-in-out',
        'slide-in': 'slideIn 0.3s ease-out',
      },
      keyframes: {
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideIn: { '0%': { transform: 'translateX(20px)', opacity: '0' }, '100%': { transform: 'translateX(0)', opacity: '1' } },
      },
    },
  },
  plugins: [],
}
