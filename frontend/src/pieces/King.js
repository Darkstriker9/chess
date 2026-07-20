// King.js — move logic for the king piece.
// Moves one square in any direction, plus castling if conditions are met.

function inBounds(row, col) {
  return row >= 0 && row < 8 && col >= 0 && col < 8;
}

const KING_OFFSETS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];

/**
 * Returns pseudo-legal moves for a king at (row, col).
 * Castling here only checks that squares are empty and pieces haven't moved —
 * it does NOT check that the king passes through or ends up in check.
 * That extra safety check should be done by the game engine before allowing it.
 *
 * @param {Array} board 8x8 array of {type, color} or null
 * @param {number} row
 * @param {number} col
 * @param {'white'|'black'} color
 * @param {{ kingMoved: boolean, rookMoved: { queenside: boolean, kingside: boolean } }} castleRights
 * @returns {Array<{row:number, col:number, isCapture:boolean, isCastle?: 'kingside'|'queenside'}>}
 */
export function getKingMoves(board, row, col, color, castleRights = null) {
  const moves = [];

  for (const [dr, dc] of KING_OFFSETS) {
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

  // Castling
  if (castleRights && !castleRights.kingMoved) {
    const backRank = color === "white" ? 7 : 0;

    if (row === backRank && col === 4) {
      // Kingside: squares f and g must be empty, rook on h must not have moved
      if (
        !castleRights.rookMoved.kingside &&
        !board[backRank][5] &&
        !board[backRank][6]
      ) {
        moves.push({
          row: backRank,
          col: 6,
          isCapture: false,
          isCastle: "kingside",
        });
      }

      // Queenside: squares b, c and d must be empty, rook on a must not have moved
      if (
        !castleRights.rookMoved.queenside &&
        !board[backRank][1] &&
        !board[backRank][2] &&
        !board[backRank][3]
      ) {
        moves.push({
          row: backRank,
          col: 2,
          isCapture: false,
          isCastle: "queenside",
        });
      }
    }
  }

  return moves;
}

export default getKingMoves;
