// Knight.js — move logic for the knight piece.
// Moves in an "L" shape and can jump over other pieces.

function inBounds(row, col) {
  return row >= 0 && row < 8 && col >= 0 && col < 8;
}

const KNIGHT_OFFSETS = [
  [-2, -1], [-2, 1],
  [-1, -2], [-1, 2],
  [1, -2], [1, 2],
  [2, -1], [2, 1],
];

/**
 * Returns pseudo-legal moves for a knight at (row, col).
 * @param {Array} board 8x8 array of {type, color} or null
 * @param {number} row
 * @param {number} col
 * @param {'white'|'black'} color
 * @returns {Array<{row:number, col:number, isCapture:boolean}>}
 */
export function getKnightMoves(board, row, col, color) {
  const moves = [];

  for (const [dr, dc] of KNIGHT_OFFSETS) {
    const r = row + dr;
    const c = col + dc;
    if (!inBounds(r, c)) continue;

    const square = board[r][c];
    if (!square) {
      moves.push({ row: r, col: c, isCapture: false });
    } else if (square.color !== color) {
      moves.push({ row: r, col: c, isCapture: true });
    }
  }

  return moves;
}

export default getKnightMoves;
