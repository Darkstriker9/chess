// Each theme is a pure-CSS treatment of the same Unicode chess glyphs —
// different fills, outlines, and (for wood/marble/neon) gradient text
// fills — so pieces look meaningfully different without needing external
// artwork. The actual color rules live in styles.css under `.theme-<id>`.
export const PIECE_THEMES = [
  { id: "classic", label: "Classic", swatch: ["#ffffff", "#000000"] },
  { id: "onyx-ivory", label: "Ruby & Gold", swatch: ["#f6c453", "#9c1f36"] },
  { id: "neon", label: "Neon", swatch: ["#7dfcff", "#ff5ad1"] },
  { id: "wood", label: "Wood", swatch: ["#f3c988", "#4a2810"] },
  { id: "marble", label: "Marble", swatch: ["#eaf3ff", "#1c3f77"] },
];

export const DEFAULT_PIECE_THEME = "classic";
export const PIECE_THEME_STORAGE_KEY = "chess:pieceTheme";
