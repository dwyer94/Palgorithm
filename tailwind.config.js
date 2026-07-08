/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        canvas: '#eceae4',
        panel: {
          white: '#ffffff',
          subtle: '#f6f4ef',
          inset: '#faf8f3',
          header: '#f4efe6',
        },
        ink: {
          DEFAULT: '#211e18',
          strong: '#1a1712',
          muted: '#4a453c',
        },
        muted: {
          DEFAULT: '#8a8378',
          light: '#a89f8f',
          lighter: '#b3aa99',
        },
        border: {
          card: '#ddd6ca',
          inner: '#e3ddd0',
          input: '#cfc7ba',
          divider: '#efe9dd',
        },
        sidebar: {
          bg: '#191712',
          hover: '#241f18',
          label: '#6b665c',
          text: '#c8c2b6',
        },
        brand: {
          DEFAULT: '#e8813a',
          hover: '#c9662a',
        },
        shared: {
          DEFAULT: '#d2691e',
          bg: '#fdf2ea',
          border: '#e8c2ab',
        },
        primary: {
          DEFAULT: '#2a6bdb',
          dark: '#2a6bbf',
          darker: '#1c4f9e',
          chipText: '#41539e',
          tint: '#eef4fc',
          tint2: '#f4f8fe',
          tint3: '#eef1fb',
          border: '#cdd6f2',
          border2: '#b8d0ee',
          border3: '#cdddf5',
        },
        success: {
          dot: '#2f9e5b',
          text: '#2f6f4a',
          bg: '#e7f4ec',
          border: '#bfe0cc',
        },
        offline: '#c4bbaa',
        provisional: {
          text: '#8a6d1a',
          bg: '#fff3d6',
          border: '#e6cf8a',
        },
        unresolved: {
          text: '#8a6d1a',
          bg: '#f4e6bf',
          bg2: '#fdf7e6',
        },
        danger: {
          text: '#b8541f',
          border: '#e8c2ab',
          bg: '#fdf5f0',
        },
        shiny: '#e0a72a',
        element: {
          neutral: '#9a938a',
          fire: '#e0592a',
          water: '#2b7fd4',
          electric: '#e0a72a',
          grass: '#4a9d3f',
          dark: '#7b5ea8',
          dragon: '#a34bd6',
          ground: '#b07a3c',
          ice: '#3fb0c9',
        },
      },
      borderRadius: {
        card: '14px',
        panel: '10px',
        node: '10px',
        chip: '6px',
        pill: '20px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,.04)',
        node: '0 1px 2px rgba(0,0,0,.05)',
        'elevated-blue': '0 2px 8px rgba(42,107,219,.14)',
        dropdown: '0 6px 20px rgba(0,0,0,.12)',
      },
    },
  },
  plugins: [],
};
