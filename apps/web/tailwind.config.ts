import type { Config } from 'tailwindcss';

export default {
  content: [
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: '#1f5199',
          dark: '#0d2a5e',
          deeper: '#0a1e47',
          light: '#2461b3',
        },
        success: {
          DEFAULT: '#10b981',
          dark: '#047857',
          light: '#d1fae5',
        },
        amber: {
          DEFAULT: '#f59e0b',
          light: '#fef3c7',
        },
        ink: {
          DEFAULT: '#1a2332',
          mid: '#495057',
          muted: '#6c757d',
        },
        bg: {
          DEFAULT: '#f7f8fa',
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['DM Mono', 'JetBrains Mono', 'Courier New', 'monospace'],
      },
      boxShadow: {
        soft: '0 4px 20px rgba(0,0,0,0.08)',
        elevated: '0 8px 30px rgba(31,81,153,0.15)',
        navy: '0 6px 25px rgba(31,81,153,0.3)',
      },
    },
  },
  plugins: [],
} satisfies Config;
