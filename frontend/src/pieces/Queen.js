// Queen.js — move logic for the queen piece.
// Combines rook (straight lines) and bishop (diagonals) movement.

import { getRookMoves } from "./Rook.js";
import { getBishopMoves } from "./Bishop.js";

/**
 * Returns pseudo-legal moves for a queen at (row, col).
 * @param {Array} board 8x8 array of {type, color} or null
 * @param {number} row
 * @param {number} col
 * @param {'white'|'black'} color
 * @returns {Array<{row:number, col:number, isCapture:boolean}>}
 */
export function getQueenMoves(board, row, col, color) {
  return [
    ...getRookMoves(board, row, col, color),
    ...getBishopMoves(board, row, col, color),
  ];
}

export default getQueenMoves;
