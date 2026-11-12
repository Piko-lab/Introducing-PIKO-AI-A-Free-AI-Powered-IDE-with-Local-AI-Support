/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        piko: {
          950: '#07080d',
          900: '#0b0d14',
          850: '#0f111a',
          800: '#131622',
          700: '#1a1e2d',
          600: '#242940',
          500: '#343b57',
          accent: '#e8eaf1',
          cyan: '#22d3ee',
          green: '#34d399',
          amber: '#fbbf24',
          red: '#f87171',
          pink: '#f472b6',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI Variable', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Cascadia Code', 'Consolas', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 24px rgba(255, 255, 255, 0.16)',
        panel: '0 18px 60px rgba(0,0,0,0.45)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'none' } },
        'slide-in': { from: { opacity: '0', transform: 'translateX(8px)' }, to: { opacity: '1', transform: 'none' } },
        pulseGlow: { '0%,100%': { opacity: '0.45' }, '50%': { opacity: '1' } },
      },
      animation: {
        'fade-in': 'fade-in 180ms ease-out',
        'slide-in': 'slide-in 200ms ease-out',
        'pulse-glow': 'pulseGlow 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
