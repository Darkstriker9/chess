const Piece = require('./piece');

const OFFSETS = [
  [-2, -1], [-2, 1],
  [-1, -2], [-1, 2],
  [1, -2], [1, 2],
  [2, -1], [2, 1],
];

class Knight extends Piece {
  get symbol() {
    return 'N';
  }

  getMoves(board, from) {
    return Piece.steps(board, from, this.color, OFFSETS);
  }
}

module.exports = Knight;
