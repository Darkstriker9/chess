const Piece = require('./piece');

class Pawn extends Piece {
  get symbol() {
    return 'P';
  }

  // Pawns move differently based on color, can move 2 squares from start,
  // capture diagonally, and support en passant (handled by Game passing enPassantTarget).
  getMoves(board, from, enPassantTarget = null) {
    const moves = [];
    const dir = this.color === 'w' ? -1 : 1; // white moves up (toward row 0), black moves down
    const startRow = this.color === 'w' ? 6 : 1;

    // One square forward
    const oneRow = from.row + dir;
    if (Piece.onBoard(oneRow, from.col) && !board[oneRow][from.col]) {
      moves.push({ row: oneRow, col: from.col });

      // Two squares forward from starting rank
      const twoRow = from.row + dir * 2;
      if (from.row === startRow && !board[twoRow][from.col]) {
        moves.push({ row: twoRow, col: from.col, doubleStep: true });
      }
    }

    // Diagonal captures
    for (const dc of [-1, 1]) {
      const row = from.row + dir;
      const col = from.col + dc;
      if (!Piece.onBoard(row, col)) continue;

      const occupant = board[row][col];
      if (occupant && occupant.color !== this.color) {
        moves.push({ row, col, capture: true });
      } else if (
        enPassantTarget &&
        enPassantTarget.row === row &&
        enPassantTarget.col === col
      ) {
        moves.push({ row, col, capture: true, enPassant: true });
      }
    }

    return moves;
  }
}

module.exports = Pawn;
