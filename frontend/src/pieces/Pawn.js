// Pawn.js — move logic for the pawn piece.
// Board convention: board[row][col], row 0 = rank 8 (top), row 7 = rank 1 (bottom).
// White moves "up" the board (decreasing row), black moves "down" (increasing row).

function inBounds(row, col) {
  return row >= 0 && row < 8 && col >= 0 && col < 8;
}

/**
 * Returns pseudo-legal moves for a pawn at (row, col).
 * Does NOT check whether the move would leave your own king in check —
 * that filtering happens one layer up, in the game engine.
 *
 * @param {Array} board 8x8 array of {type, color} or null
 * @param {number} row
 * @param {number} col
 * @param {'white'|'black'} color
 * @param {{row:number, col:number}|null} enPassantTarget square that can be captured en passant this turn
 * @returns {Array<{row:number, col:number, isCapture:boolean, isEnPassant?:boolean, isPromotion?:boolean}>}
 */
export function getPawnMoves(board, row, col, color, enPassantTarget = null) {
  const moves = [];
  const direction = color === "white" ? -1 : 1;
  const startRow = color === "white" ? 6 : 1;
  const promotionRow = color === "white" ? 0 : 7;

  // One step forward
  const oneStep = row + direction;
  if (inBounds(oneStep, col) && !board[oneStep][col]) {
    moves.push({
      row: oneStep,
      col,
      isCapture: false,
      isPromotion: oneStep === promotionRow,
    });

    // Two steps forward from starting position
    const twoStep = row + direction * 2;
    if (row === startRow && !board[twoStep][col]) {
      moves.push({ row: twoStep, col, isCapture: false });
    }
  }

  // Diagonal captures
  for (const dc of [-1, 1]) {
    const targetRow = row + direction;
    const targetCol = col + dc;
    if (!inBounds(targetRow, targetCol)) continue;

    const targetSquare = board[targetRow][targetCol];
    if (targetSquare && targetSquare.color !== color) {
      moves.push({
        row: targetRow,
        col: targetCol,
        isCapture: true,
        isPromotion: targetRow === promotionRow,
      });
    } else if (
      enPassantTarget &&
      enPassantTarget.row === targetRow &&
      enPassantTarget.col === targetCol
    ) {
      moves.push({
        row: targetRow,
        col: targetCol,
        isCapture: true,
        isEnPassant: true,
      });
    }
  }

  return moves;
}

export default getPawnMoves;
