// Simple, original geometric silhouettes for each piece type — not a
// copy of any existing chess set's artwork. Every shape uses
// fill="currentColor" so the existing `.piece.white` / `.piece.black`
// (and per-theme) CSS rules still control color via the `color` property,
// same as before. The difference is these are real vector shapes, so
// there's no dependency on how any particular browser/OS font decides to
// render chess Unicode characters (which is what was actually breaking —
// some platforms render those characters via a color-emoji-style font
// that ignores CSS color/stroke/filter entirely, which explains why fixes
// that worked in theory kept not showing up).

function Base() {
  return <rect className="piece-shape" x="9" y="37" width="27" height="4.5" rx="1" />;
}

function Pawn() {
  return (
    <>
      <circle className="piece-shape" cx="22.5" cy="14" r="6" />
      <path className="piece-shape" d="M15 34 C15 24 30 24 30 34 Z" />
      <Base />
    </>
  );
}

function Rook() {
  return (
    <>
      <rect className="piece-shape" x="13" y="9" width="4" height="5" />
      <rect className="piece-shape" x="20.5" y="9" width="4" height="5" />
      <rect className="piece-shape" x="28" y="9" width="4" height="5" />
      <rect className="piece-shape" x="12" y="13" width="21" height="5" />
      <path className="piece-shape" d="M15 18 L30 18 L30 34 L15 34 Z" />
      <Base />
    </>
  );
}

function Bishop() {
  return (
    <>
      <circle className="piece-shape" cx="22.5" cy="8.5" r="2.6" />
      <path className="piece-shape" d="M22.5 12 C28 16 30 22 30 33 L15 33 C15 22 17 16 22.5 12 Z" />
      <rect className="piece-shape" x="17" y="32" width="11" height="3" />
      <Base />
    </>
  );
}

function Knight() {
  return (
    <>
      <path
        className="piece-shape"
        d="M27 9 C31 9 33 12 32 16 L34 22 L30 23 L29 20 C27 22 25 21 23 22 L25 27 L25 34 L14 34 L14 27
           C14 21 16 18 15 14 C18 10 24 8 27 9 Z"
      />
      <circle className="piece-shape" cx="28" cy="14" r="1.1" />
      <Base />
    </>
  );
}

function Queen() {
  return (
    <>
      <circle className="piece-shape" cx="15" cy="14" r="2" />
      <circle className="piece-shape" cx="19.2" cy="10.5" r="2" />
      <circle className="piece-shape" cx="22.5" cy="9" r="2" />
      <circle className="piece-shape" cx="25.8" cy="10.5" r="2" />
      <circle className="piece-shape" cx="30" cy="14" r="2" />
      <path className="piece-shape" d="M16 16 C19 15 26 15 29 16 L30 32 L15 32 Z" />
      <rect className="piece-shape" x="16" y="32" width="13" height="3" />
      <Base />
    </>
  );
}

function King() {
  return (
    <>
      <rect className="piece-shape" x="21" y="5" width="3" height="8" />
      <rect className="piece-shape" x="18.5" y="7.5" width="8" height="3" />
      <path className="piece-shape" d="M22.5 15 C28 18 30 23 30 32 L15 32 C15 23 17 18 22.5 15 Z" />
      <rect className="piece-shape" x="16" y="32" width="13" height="3" />
      <Base />
    </>
  );
}

const SHAPES = { p: Pawn, r: Rook, n: Knight, b: Bishop, q: Queen, k: King };

export default function PieceIcon({ type, color }) {
  const Shape = SHAPES[type];
  if (!Shape) return null;
  return (
    <svg className={`piece piece-svg ${color}`} viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg">
      <Shape />
    </svg>
  );
}
