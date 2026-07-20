// Bishop.js — move logic for the bishop piece.
// Moves any number of squares diagonally until blocked.

function inBounds(row, col) {
  return row >= 0 && row < 8 && col >= 0 && col < 8;
}

const DIRECTIONS = [
  [-1, -1], // up-left
  [-1, 1], // up-right
  [1, -1], // down-left
  [1, 1], // down-right
];

/**
 * Returns pseudo-legal moves for a bishop at (row, col).
 * @param {Array} board 8x8 array of {type, color} or null
 * @param {number} row
 * @param {number} col
 * @param {'white'|'black'} color
 * @returns {Array<{row:number, col:number, isCapture:boolean}>}
 */
export function getBishopMoves(board, row, col, color) {
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
        break;
      }

      r += dr;
      c += dc;
    }
  }

  return moves;
}

export default getBishopMoves;
