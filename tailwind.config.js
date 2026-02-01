// tailwind.config.js
module.exports = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      keyframes: {
        bump: {
          '0%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.05)' },
          '100%': { transform: 'scale(1)' },
        },
      },
      animation: {
        bump: 'bump 300ms ease-out',
      },
      boxShadow: {
        // Menu button glow
        'menu-glow': '0 0 8px rgba(156,237,255,0.4), 0 0 7px rgba(156,237,255,0.4), inset 0 0 15px rgba(156,237,255,0.8)',
        'menu-hover': '0 0 6px rgba(255,255,255,0.3), 0 0 4px rgba(255,255,255,0.2)',
        // Panel glow effects - 2 layer glow (inner strong + outer soft)
        // Layer 1: 테두리 근처 강한 glow (0-15px)
        // Layer 2: 멀리 퍼지는 약한 glow (20-50px)
        // Panel glow - subtle (2 layer)
        'glow-orange': [
          '0 0 3px rgba(255,140,0,0.4)',    // inner
          '0 0 8px rgba(255,140,0,0.2)',    // outer
        ].join(', '),
        'glow-cyan': [
          '0 0 3px rgba(78,205,196,0.4)',
          '0 0 8px rgba(78,205,196,0.2)',
        ].join(', '),
        'glow-blue': [
          '0 0 3px rgba(94,197,255,0.4)',
          '0 0 8px rgba(94,197,255,0.2)',
        ].join(', '),
        'glow-green': [
          '0 0 3px rgba(39,174,96,0.4)',
          '0 0 8px rgba(39,174,96,0.2)',
        ].join(', '),
        'glow-purple': [
          '0 0 3px rgba(155,89,182,0.4)',
          '0 0 8px rgba(155,89,182,0.2)',
        ].join(', '),
        'glow-red': [
          '0 0 3px rgba(231,76,60,0.4)',
          '0 0 8px rgba(231,76,60,0.2)',
        ].join(', '),
        // Menu container glow
        'menu-container-glow': [
          '0 0 6px rgba(94,197,255,0.3)',
          '0 0 15px rgba(94,197,255,0.15)',
          '0 0 30px rgba(94,197,255,0.08)',
        ].join(', '),
        // Stronger glow for selected/active states (moderate)
        'glow-orange-strong': [
          '0 0 4px rgba(255,140,0,0.6)',
          '0 0 10px rgba(255,140,0,0.3)',
          '0 0 20px rgba(255,140,0,0.15)',
        ].join(', '),
        'glow-cyan-strong': [
          '0 0 4px rgba(78,205,196,0.6)',
          '0 0 10px rgba(78,205,196,0.3)',
          '0 0 20px rgba(78,205,196,0.15)',
        ].join(', '),
        'glow-blue-strong': [
          '0 0 4px rgba(94,197,255,0.6)',
          '0 0 10px rgba(94,197,255,0.3)',
          '0 0 20px rgba(94,197,255,0.15)',
        ].join(', '),
      },      
      spacing: {
        24: "6rem", // 96px
        32: "8rem", // 128px
        36: "9rem", // 144px
        40: "10rem", // 160px
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      colors: {
        // Menu system colors
        menu: {
          'active-bg': 'rgba(94, 197, 255, 0.85)',
          'inactive-bg': '#262C3F',
          'container-bg': '#353948',
          'container-bg-lv2': '#464959',
          'border-active': 'rgba(156, 237, 255, 1.0)',
          'border-container': '#778397',
          'border-container-lv2': '#889498',
        },
        // Panel system colors (dark theme)
        panel: {
          'bg': 'rgba(30, 40, 60, 0.95)',
          'bg-solid': '#1e283c',
          'bg-light': 'rgba(40, 50, 70, 0.9)',
          'border': 'rgba(100, 130, 160, 0.5)',
          'border-light': 'rgba(130, 150, 180, 0.4)',
        },
        // Accent colors
        'accent-orange': '#FF8C00',
        'accent-orange-light': '#FFA033',
        'accent-cyan': '#4ecdc4',
        'accent-green': '#27ae60',
        'accent-red': '#e74c3c',
        'accent-purple': '#9b59b6',
        'accent-yellow': '#f39c12',
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        chart: {
          1: "hsl(var(--chart-1))",
          2: "hsl(var(--chart-2))",
          3: "hsl(var(--chart-3))",
          4: "hsl(var(--chart-4))",
          5: "hsl(var(--chart-5))",
        },
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
