// Base class for all chess pieces.
// Each concrete piece (pawn.js, rook.js, knight.js, bishop.js, queen.js, king.js)
// extends this and implements getMoves().

class Piece {
  constructor(color) {
    // color is 'w' or 'b'
    this.color = color;
  }

  get symbol() {
    // Overridden by subclasses, e.g. 'P', 'N', 'B', 'R', 'Q', 'K'
    throw new Error('symbol getter must be implemented by subclass');
  }

  // Returns the FEN-style character for this piece: uppercase for white, lowercase for black
  get fenChar() {
    return this.color === 'w' ? this.symbol.toUpperCase() : this.symbol.toLowerCase();
  }

  // board: 8x8 array, board[row][col] = Piece instance or null. row 0 = rank 8 (top), col 0 = file a
  // from: { row, col }
  // Returns a list of { row, col } squares this piece could pseudo-legally move to
  // (does not account for checks - that filtering happens in Game.js)
  getMoves(board, from) {
    throw new Error('getMoves must be implemented by subclass');
  }

  // Helper: is the square on the board
  static onBoard(row, col) {
    return row >= 0 && row < 8 && col >= 0 && col < 8;
  }

  // Helper: walk in a direction until hitting the edge, a friendly piece (stop before),
  // or an enemy piece (include, then stop). Used by rook/bishop/queen.
  static slide(board, from, color, directions) {
    const moves = [];
    for (const [dr, dc] of directions) {
      let row = from.row + dr;
      let col = from.col + dc;
      while (Piece.onBoard(row, col)) {
        const occupant = board[row][col];
        if (!occupant) {
          moves.push({ row, col });
        } else {
          if (occupant.color !== color) moves.push({ row, col });
          break;
        }
        row += dr;
        col += dc;
      }
    }
    return moves;
  }

  // Helper: fixed offset moves (knight/king), filtering out own-color occupied squares
  static steps(board, from, color, offsets) {
    const moves = [];
    for (const [dr, dc] of offsets) {
      const row = from.row + dr;
      const col = from.col + dc;
      if (!Piece.onBoard(row, col)) continue;
      const occupant = board[row][col];
      if (!occupant || occupant.color !== color) {
        moves.push({ row, col });
      }
    }
    return moves;
  }
}

module.exports = Piece;
