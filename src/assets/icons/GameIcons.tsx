/**
 * Game-style SVG Icons for VPS Simulator
 * Style: 12c.png reference
 * - Always same vivid orange (active/inactive 무관)
 * - Thick black outline around every icon shape
 * - High saturation, deep orange
 * - Selection state is handled by button container glow, NOT icon color
 */
import React from "react";

interface IconProps {
  size?: number;
}

// ─── Color Constants ────────────────────────────────────────────
const O = "#E8710A";       // Deep saturated orange (primary fill)
const OL = "#F59E0B";      // Orange highlight (gradient top)
const OD = "#C2410C";      // Dark orange (gradient bottom / shadow)
const W = "#F1F5F9";       // White accent
const WD = "#CBD5E1";      // Dimmed white
const BK = "#1A1A1A";      // Black outline color
const SW = 2.5;            // Standard stroke width for outlines (thick black border)

// ─── MapLoader (Folder with arrow) ──────────────────────────────
export const IconMapLoader: React.FC<IconProps> = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <defs>
      <linearGradient id="fld-g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={OL} />
        <stop offset="100%" stopColor={OD} />
      </linearGradient>
    </defs>
    {/* Folder tab */}
    <path
      d="M4 10C4 8.34 5.34 7 7 7H13L15.5 10H27C28.66 10 30 11.34 30 13V24C30 25.66 28.66 27 27 27H7C5.34 27 4 25.66 4 24V10Z"
      fill="url(#fld-g)"
      stroke={BK}
      strokeWidth={SW}
    />
    {/* Folder front */}
    <path
      d="M4 14C4 12.9 4.9 12 6 12H26C27.1 12 28 12.9 28 14V24C28 25.66 26.66 27 25 27H7C5.34 27 4 25.66 4 24V14Z"
      fill={O}
      stroke={BK}
      strokeWidth={SW}
    />
    {/* Arrow down */}
    <path
      d="M16 15V23M16 23L12.5 19.5M16 23L19.5 19.5"
      stroke={W}
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// ─── Statistics (Pie Chart) ─────────────────────────────────────
export const IconStatistics: React.FC<IconProps> = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <defs>
      <linearGradient id="pie-g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor={OL} />
        <stop offset="100%" stopColor={OD} />
      </linearGradient>
    </defs>
    {/* Pie circle */}
    <circle cx="16" cy="16" r="12" fill="url(#pie-g)" stroke={BK} strokeWidth={SW} />
    {/* White slice */}
    <path d="M16 16V4A12 12 0 0 1 27.4 20Z" fill={W} stroke={BK} strokeWidth={SW} strokeLinejoin="round" />
    {/* Divider line */}
    <line x1="16" y1="16" x2="16" y2="4" stroke={BK} strokeWidth={SW} />
    <line x1="16" y1="16" x2="27.4" y2="20" stroke={BK} strokeWidth={SW} />
  </svg>
);

// ─── Search (Magnifying Glass) ──────────────────────────────────
export const IconSearch: React.FC<IconProps> = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    {/* Handle */}
    <line x1="21.5" y1="21.5" x2="28" y2="28" stroke={O} strokeWidth="4" strokeLinecap="round" />
    <line x1="21.5" y1="21.5" x2="28" y2="28" stroke={BK} strokeWidth="5.5" strokeLinecap="round" opacity="0.3" />
    <line x1="21.5" y1="21.5" x2="28" y2="28" stroke={O} strokeWidth="3.5" strokeLinecap="round" />
    {/* Glass outer */}
    <circle cx="14" cy="14" r="9.5" fill={WD} stroke={BK} strokeWidth={SW} />
    {/* Glass inner */}
    <circle cx="14" cy="14" r="6.5" fill={O} opacity="0.3" />
    {/* Lens glare */}
    <path d="M10 9.5C11 8 12.5 7 14.5 7" stroke={W} strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
  </svg>
);

// ─── Vehicle (Car top-down) ─────────────────────────────────────
export const IconVehicle: React.FC<IconProps> = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <defs>
      <linearGradient id="car-g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={OL} />
        <stop offset="100%" stopColor={OD} />
      </linearGradient>
    </defs>
    {/* Wheels */}
    <rect x="5" y="8" width="3.5" height="5.5" rx="1.5" fill={OD} stroke={BK} strokeWidth="1.2" />
    <rect x="5" y="19" width="3.5" height="5.5" rx="1.5" fill={OD} stroke={BK} strokeWidth="1.2" />
    <rect x="23.5" y="8" width="3.5" height="5.5" rx="1.5" fill={OD} stroke={BK} strokeWidth="1.2" />
    <rect x="23.5" y="19" width="3.5" height="5.5" rx="1.5" fill={OD} stroke={BK} strokeWidth="1.2" />
    {/* Car body */}
    <rect x="8" y="3.5" width="16" height="25" rx="5" fill="url(#car-g)" stroke={BK} strokeWidth={SW} />
    {/* Windshield */}
    <rect x="10.5" y="6.5" width="11" height="6" rx="2.5" fill={W} stroke={BK} strokeWidth="1.2" opacity="0.9" />
    {/* Rear window */}
    <rect x="10.5" y="20.5" width="11" height="5" rx="2" fill={W} stroke={BK} strokeWidth="1.2" opacity="0.55" />
  </svg>
);

// ─── Operation (Ship Wheel / Helm) ──────────────────────────────
export const IconOperation: React.FC<IconProps> = ({ size = 24 }) => {
  const cx = 16, cy = 16, r = 10;
  const angles = [0, 60, 120, 180, 240, 300];
  const spokes = angles.map((deg) => {
    const rad = (deg * Math.PI) / 180;
    return {
      x1: cx + Math.cos(rad) * 4.5,
      y1: cy + Math.sin(rad) * 4.5,
      x2: cx + Math.cos(rad) * r,
      y2: cy + Math.sin(rad) * r,
    };
  });
  const knobs = angles.map((deg) => {
    const rad = (deg * Math.PI) / 180;
    return { cx: cx + Math.cos(rad) * (r + 1.2), cy: cy + Math.sin(rad) * (r + 1.2) };
  });
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      {/* Spokes */}
      {spokes.map((s, i) => (
        <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
          stroke={BK} strokeWidth="3.5" strokeLinecap="round" />
      ))}
      {spokes.map((s, i) => (
        <line key={`o${i}`} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
          stroke={O} strokeWidth="2" strokeLinecap="round" />
      ))}
      {/* Outer ring */}
      <circle cx={cx} cy={cy} r={r} stroke={BK} strokeWidth="3.5" fill="none" />
      <circle cx={cx} cy={cy} r={r} stroke={O} strokeWidth="2" fill="none" />
      {/* Knobs */}
      {knobs.map((k, i) => (
        <React.Fragment key={`kb${i}`}>
          <circle cx={k.cx} cy={k.cy} r="2.2" fill={BK} />
          <circle cx={k.cx} cy={k.cy} r="1.5" fill={O} />
        </React.Fragment>
      ))}
      {/* Inner ring */}
      <circle cx={cx} cy={cy} r="4.5" fill={O} stroke={BK} strokeWidth={SW} />
      {/* Center hub */}
      <circle cx={cx} cy={cy} r="2" fill={W} stroke={BK} strokeWidth="1" />
    </svg>
  );
};

// ─── MapBuilder (Railroad Track) ────────────────────────────────
export const IconMapBuilder: React.FC<IconProps> = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    {/* Cross ties */}
    {[5, 10.5, 16, 21.5, 27].map((y) => (
      <rect key={y} x="6" y={y} width="20" height="3" rx="1" fill={O} stroke={BK} strokeWidth="1.2" />
    ))}
    {/* Left rail */}
    <rect x="8.5" y="2" width="3" height="28" rx="1.5" fill={W} stroke={BK} strokeWidth={SW} />
    {/* Right rail */}
    <rect x="20.5" y="2" width="3" height="28" rx="1.5" fill={W} stroke={BK} strokeWidth={SW} />
  </svg>
);

// ─── LayoutBuilder (Building) ───────────────────────────────────
export const IconLayoutBuilder: React.FC<IconProps> = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <defs>
      <linearGradient id="bld-g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={OL} />
        <stop offset="100%" stopColor={OD} />
      </linearGradient>
    </defs>
    {/* Main building */}
    <rect x="4" y="9" width="15" height="19" rx="2" fill="url(#bld-g)" stroke={BK} strokeWidth={SW} />
    {/* Tower */}
    <rect x="19" y="4" width="10" height="24" rx="2" fill={O} stroke={BK} strokeWidth={SW} />
    {/* Windows - main */}
    <rect x="7" y="12" width="3.5" height="3" rx="0.8" fill={W} stroke={BK} strokeWidth="0.8" />
    <rect x="12.5" y="12" width="3.5" height="3" rx="0.8" fill={W} stroke={BK} strokeWidth="0.8" />
    <rect x="7" y="18" width="3.5" height="3" rx="0.8" fill={W} stroke={BK} strokeWidth="0.8" />
    <rect x="12.5" y="18" width="3.5" height="3" rx="0.8" fill={W} stroke={BK} strokeWidth="0.8" />
    {/* Door */}
    <rect x="9.5" y="24" width="4" height="4" rx="1" fill={W} stroke={BK} strokeWidth="0.8" opacity="0.7" />
    {/* Windows - tower */}
    <rect x="22" y="7" width="4" height="3" rx="0.8" fill={W} stroke={BK} strokeWidth="0.8" />
    <rect x="22" y="13" width="4" height="3" rx="0.8" fill={W} stroke={BK} strokeWidth="0.8" />
    <rect x="22" y="19" width="4" height="3" rx="0.8" fill={W} stroke={BK} strokeWidth="0.8" />
  </svg>
);

// ─── Visualization (Stacked Layers) ─────────────────────────────
export const IconVisualization: React.FC<IconProps> = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    {/* Bottom layer */}
    <path d="M4 22L16 28L28 22L16 16L4 22Z" fill={OD} stroke={BK} strokeWidth={SW} strokeLinejoin="round" />
    {/* Middle layer */}
    <path d="M4 17L16 23L28 17L16 11L4 17Z" fill={O} stroke={BK} strokeWidth={SW} strokeLinejoin="round" />
    {/* Top layer */}
    <path d="M4 12L16 18L28 12L16 6L4 12Z" fill={OL} stroke={BK} strokeWidth={SW} strokeLinejoin="round" />
    {/* Top highlight */}
    <path d="M5.5 12L16 6.8L26.5 12" stroke={W} strokeWidth="0.8" fill="none" opacity="0.5" />
  </svg>
);

// ─── DataPanel (Table Grid) ─────────────────────────────────────
export const IconDataPanel: React.FC<IconProps> = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    {/* Table body */}
    <rect x="3" y="4" width="26" height="24" rx="3" fill={OD} opacity="0.3" stroke={BK} strokeWidth={SW} />
    {/* Header */}
    <path d="M3 7C3 5.34 4.34 4 6 4H26C27.66 4 29 5.34 29 7V11H3V7Z" fill={O} stroke={BK} strokeWidth={SW} />
    {/* Header cells */}
    <rect x="6" y="6.5" width="6" height="2.5" rx="1" fill={W} opacity="0.9" />
    <rect x="14" y="6.5" width="6" height="2.5" rx="1" fill={W} opacity="0.9" />
    <rect x="22" y="6.5" width="4" height="2.5" rx="1" fill={W} opacity="0.9" />
    {/* Rows */}
    {[15, 20, 25].map((y) => (
      <React.Fragment key={y}>
        <rect x="6" y={y} width="6" height="2" rx="0.8" fill={W} opacity="0.45" />
        <rect x="14" y={y} width="6" height="2" rx="0.8" fill={W} opacity="0.45" />
        <rect x="22" y={y} width="4" height="2" rx="0.8" fill={W} opacity="0.45" />
      </React.Fragment>
    ))}
    {/* Grid lines */}
    <line x1="12.5" y1="4" x2="12.5" y2="28" stroke={BK} strokeWidth="0.6" opacity="0.4" />
    <line x1="21" y1="4" x2="21" y2="28" stroke={BK} strokeWidth="0.6" opacity="0.4" />
  </svg>
);

// ─── DevTools (Wrench) ──────────────────────────────────────────
export const IconDevTools: React.FC<IconProps> = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <defs>
      <linearGradient id="wr-g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor={OL} />
        <stop offset="100%" stopColor={OD} />
      </linearGradient>
    </defs>
    {/* Wrench body */}
    <path
      d="M22.5 4.5C19.2 3.2 15.3 4 12.8 6.5C10.8 8.5 10 11.3 10.5 14L4.5 20C3.2 21.3 3.2 23.5 4.5 24.8L7.2 27.5C8.5 28.8 10.7 28.8 12 27.5L18 21.5C20.7 22 23.5 21.2 25.5 19.2C28 16.7 28.8 12.8 27.5 9.5L23 14L19 13L18 9L22.5 4.5Z"
      fill="url(#wr-g)"
      stroke={BK}
      strokeWidth={SW}
      strokeLinejoin="round"
    />
    {/* Jaw notch */}
    <path d="M23 14L19 13L18 9" stroke={BK} strokeWidth="1.2" fill="none" opacity="0.5" />
    {/* Bolt hole */}
    <circle cx="8.2" cy="23.8" r="1.8" fill={W} stroke={BK} strokeWidth="1" opacity="0.7" />
  </svg>
);
