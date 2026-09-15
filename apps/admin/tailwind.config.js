/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#d9e6ff',
          500: '#3b6dfb',
          600: '#2a54e0',
          700: '#213fb0',
        },
      },
    },
  },
  plugins: [],
};
