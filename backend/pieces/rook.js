const Piece = require('./piece');

const DIRECTIONS = [
  [-1, 0], // up
  [1, 0],  // down
  [0, -1], // left
  [0, 1],  // right
];

class Rook extends Piece {
  get symbol() {
    return 'R';
  }

  getMoves(board, from) {
    return Piece.slide(board, from, this.color, DIRECTIONS);
  }
}

module.exports = Rook;
