// Rook.js — move logic for the rook piece.
// Moves any number of squares horizontally or vertically until blocked.

function inBounds(row, col) {
  return row >= 0 && row < 8 && col >= 0 && col < 8;
}

const DIRECTIONS = [
  [-1, 0], // up
  [1, 0], // down
  [0, -1], // left
  [0, 1], // right
];

/**
 * Returns pseudo-legal moves for a rook at (row, col).
 * @param {Array} board 8x8 array of {type, color} or null
 * @param {number} row
 * @param {number} col
 * @param {'white'|'black'} color
 * @returns {Array<{row:number, col:number, isCapture:boolean}>}
 */
export function getRookMoves(board, row, col, color) {
  const moves = [];

  for (const [dr, dc] of DIRECTIONS) {
    let r = row + dr;
    let c = col + dc;

    while (inBounds(r, c)) {
      const square = board[r][c];

      if (!square) {
        moves.push({ row: r, col: c, isCapture: false });
      } else {
        if (square.color !== color) {
          moves.push({ row: r, col: c, isCapture: true });
        }
        break; // blocked, whether by friend or foe
      }

      r += dr;
      c += dc;
    }
  }

  return moves;
}

export default getRookMoves;
