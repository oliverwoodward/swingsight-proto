/**
 * SwingSight brand palette. Kept separate from the template's light/dark `Colors`
 * (which the ThemeColor type keys off) so we can layer brand accents without
 * widening that type. Overlay colours here are the source of truth for the skeleton
 * and the fault highlight.
 */
export const Brand = {
  /** Primary action / golf green. */
  accent: '#1FA463',
  accentDark: '#16834E',
  onAccent: '#FFFFFF',

  /** Fault highlight + caution. */
  highlight: '#F5A524',
  danger: '#E5484D',
  success: '#1FA463',

  /** Skeleton overlay. */
  skeleton: '#FFFFFF',
  skeletonDim: 'rgba(255,255,255,0.30)',
  skeletonJoint: '#9BE7C4',

  /** Neutral surfaces used on dark capture/report screens. */
  scrim: 'rgba(0,0,0,0.55)',
  surfaceDark: '#15171A',
} as const;
