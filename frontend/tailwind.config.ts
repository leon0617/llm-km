import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: 'rgb(var(--color-sf-primary) / <alpha-value>)',
        'primary-container': 'rgb(var(--color-sf-primary-container) / <alpha-value>)',
        'on-primary': 'rgb(var(--color-sf-on-primary) / <alpha-value>)',
        'on-primary-container': 'rgb(var(--color-sf-on-primary-container) / <alpha-value>)',
        surface: 'rgb(var(--color-sf-surface) / <alpha-value>)',
        'surface-variant': 'rgb(var(--color-sf-surface-variant) / <alpha-value>)',
        'on-surface': 'rgb(var(--color-sf-on-surface) / <alpha-value>)',
        'on-surface-variant': 'rgb(var(--color-sf-on-surface-variant) / <alpha-value>)',
        'outline-variant': 'rgb(var(--color-sf-outline-variant) / <alpha-value>)',
        outline: 'rgb(var(--color-sf-outline) / <alpha-value>)',
        success: 'rgb(var(--color-sf-success) / <alpha-value>)',
        error: 'rgb(var(--color-sf-error) / <alpha-value>)',
        warning: 'rgb(var(--color-sf-warning) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Noto Sans TC', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'Roboto Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        sm: '4px',
        md: '6px',
        lg: '8px',
        xl: '12px',
        '2xl': '16px',
      },
      boxShadow: {
        e1: '0 1px 2px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.10)',
        e2: '0 2px 4px rgba(0,0,0,0.06), 0 3px 6px rgba(0,0,0,0.08)',
        'focus-ring': '0 0 0 4px rgba(40,119,238,0.16)',
      },
    },
  },
  plugins: [],
}

export default config
