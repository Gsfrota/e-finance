/** @type {import('tailwindcss').Config} */
// Tema migrado 1:1 do objeto `tailwind.config` que vivia inline no index.html,
// quando o Tailwind vinha do Play CDN. Nenhum valor foi alterado — qualquer
// diferença aqui muda a aparência do app em produção.
export default {
  content: [
    './index.html',
    './index.tsx',
    './App.tsx',
    './components/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
    './services/**/*.{ts,tsx}',
    './utils/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        display: ['Playfair Display', 'serif'],
      },
      colors: {
        ink: {
          950: '#0a1020',
          900: '#0f1d33',
          850: '#172540',
          800: '#1c2d4d',
          700: '#223558',
          600: '#2e4470',
        },
        brass: {
          300: '#f5c842',
          400: '#f0b429',
          500: '#d49a18',
          600: '#b07f10',
        },
        sage: {
          300: '#6ee7b7',
          400: '#34d399',
          500: '#10b981',
        },
        rust: {
          300: '#fca5a5',
          400: '#f87171',
          500: '#ef4444',
        },
        steel: {
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
        },
      },
    },
  },
  plugins: [],
};
