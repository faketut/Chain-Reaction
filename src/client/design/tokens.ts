// Chain Reaction — design tokens (Phaser-side mirror of styles.css).
// Numbers are 0xRRGGBB so Phaser Graphics/Text accept them directly.
// Strings are CSS-compatible for HTML overlays.

export const COLOR = {
  paper:    0xf2ede0,
  paper2:   0xece6d5,
  graphite: 0x1f2024,
  rule:     0xc9c2b0,
  carmine:  0xc8312b,
  seal:     0x1b5e50,
  ochre:    0xd4a23a,
  // Translucent variants for ghosts / overlays.
  ghost:    0x1f2024,
  goalFill: 0xc8312b,
} as const;

export const COLOR_CSS = {
  paper:    '#F2EDE0',
  graphite: '#1F2024',
  rule:     '#C9C2B0',
  carmine:  '#C8312B',
  seal:     '#1B5E50',
  ochre:    '#D4A23A',
} as const;

export const FONT = {
  display: '"DM Serif Display", Georgia, serif',
  body:    '"Inter", system-ui, sans-serif',
  mono:    '"JetBrains Mono", ui-monospace, "Courier New", monospace',
} as const;

export const TYPE = {
  // Phaser Text style presets. Sizes assume world is rendered at 800x1200.
  prompt: {
    fontFamily: FONT.display,
    fontStyle: 'italic',
    fontSize: '34px',
    color: COLOR_CSS.graphite,
    align: 'left',
    wordWrap: { width: 720 },
  } satisfies Phaser.Types.GameObjects.Text.TextStyle,
  annotation: {
    fontFamily: FONT.mono,
    fontSize: '13px',
    color: COLOR_CSS.graphite,
    align: 'left',
  } satisfies Phaser.Types.GameObjects.Text.TextStyle,
  paletteLabel: {
    fontFamily: FONT.mono,
    fontSize: '11px',
    color: COLOR_CSS.graphite,
    align: 'center',
  } satisfies Phaser.Types.GameObjects.Text.TextStyle,
  toast: {
    fontFamily: FONT.body,
    fontSize: '14px',
    color: COLOR_CSS.graphite,
  } satisfies Phaser.Types.GameObjects.Text.TextStyle,
  banner: {
    fontFamily: FONT.display,
    fontStyle: 'italic',
    fontSize: '48px',
    color: COLOR_CSS.paper,
    align: 'center',
  } satisfies Phaser.Types.GameObjects.Text.TextStyle,
} as const;

export const GRID_PX = 32;          // matches PLAYAREA_PAD; visual grid spacing
// Pixel-level free placement: no snapping. Grid lines remain a visual guide
// only. Set to GRID_PX / 2 (= 16) for half-cell snapping or GRID_PX for
// cell-corner snapping if you want a tighter, more deterministic feel.
export const SNAP_PX = 1;
export const SKETCH_WOBBLE_PX = 2.5; // max per-vertex jitter for hand-drawn feel
export const STROKE_WIDTH = 3.5;
