// index.js — central place that ties all six piece files together.
// Each piece still lives in its own file (Pawn.js, Rook.js, etc.);
// this just gives the rest of the app one function to call.

import { getPawnMoves } from "./Pawn.js";
import { getRookMoves } from "./Rook.js";
import { getKnightMoves } from "./Knight.js";
import { getBishopMoves } from "./Bishop.js";
import { getQueenMoves } from "./Queen.js";
import { getKingMoves } from "./King.js";

// U+FE0E (VARIATION SELECTOR-15) forces "text presentation" instead of
// letting some platforms/fonts render these as colorful emoji glyphs.
// Without it, certain characters (queen/king especially) can render via
// a color-emoji font that ignores CSS `color`/text-stroke entirely — the
// piece looks "stuck" on one color no matter which theme is selected.
const VS15 = "\uFE0E";

// Unicode actually has two glyph sets for chess pieces — a "white" set
// (♔♕♖♗♘♙, designed as hollow/outline shapes) and a "black" set (♚♛♜♝♞♟,
// designed as solid shapes). We deliberately use the SOLID set for BOTH
// colors here, controlling white-vs-black purely through CSS `color`.
// The hollow set renders inconsistently across devices/fonts — on some,
// the outline is so thin that our text-stroke (needed so a piece is
// visible on a same-colored square) ends up swallowing the thin fill
// almost entirely, making "white" pieces read as dark/black instead of
// light. The solid glyphs always have enough filled area for the color
// to actually read correctly.
const SOLID_GLYPHS = { p: "♟", r: "♜", n: "♞", b: "♝", q: "♛", k: "♚" };
const withVS15 = (glyphs) => Object.fromEntries(Object.entries(glyphs).map(([k, v]) => [k, v + VS15]));

export const UNICODE_PIECES = {
  white: withVS15(SOLID_GLYPHS),
  black: withVS15(SOLID_GLYPHS),
};

/**
 * Dispatches to the correct piece file based on piece type.
 * @param {Array} board
 * @param {number} row
 * @param {number} col
 * @param {{type:string, color:string}} piece
 * @param {object} extra { enPassantTarget, castleRights }
 */
export function getMovesForPiece(board, row, col, piece, extra = {}) {
  switch (piece.type) {
    case "p":
      return getPawnMoves(board, row, col, piece.color, extra.enPassantTarget);
    case "r":
      return getRookMoves(board, row, col, piece.color);
    case "n":
      return getKnightMoves(board, row, col, piece.color);
    case "b":
      return getBishopMoves(board, row, col, piece.color);
    case "q":
      return getQueenMoves(board, row, col, piece.color);
    case "k":
      return getKingMoves(board, row, col, piece.color, extra.castleRights);
    default:
      return [];
  }
}

export function createInitialBoard() {
  const emptyRow = () => Array(8).fill(null);
  const backRank = (color) => [
    { type: "r", color },
    { type: "n", color },
    { type: "b", color },
    { type: "q", color },
    { type: "k", color },
    { type: "b", color },
    { type: "n", color },
    { type: "r", color },
  ];

  return [
    backRank("black"),
    Array(8).fill({ type: "p", color: "black" }),
    emptyRow(),
    emptyRow(),
    emptyRow(),
    emptyRow(),
    Array(8).fill({ type: "p", color: "white" }),
    backRank("white"),
  ];
}
