/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#f3efe6',
        ink: '#1a2332',
        teal: { DEFAULT: '#0c6b66', dark: '#084e4b', soft: '#e5f3f1' },
        line: '#e4dccf',
        card: '#fffcf7',
      },
      fontFamily: {
        sans: ['Outfit', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['"Source Serif 4"', 'Georgia', 'serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(26, 35, 50, 0.04), 0 8px 24px rgba(26, 35, 50, 0.04)',
      },
    },
  },
  plugins: [],
};
