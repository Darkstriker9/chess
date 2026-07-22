// chessEngine.js — the "rules" layer sitting on top of the individual
// piece files. This is where check, checkmate, stalemate, draw conditions,
// and notation live. The piece files only know "how does this piece move
// on an empty consideration of the board" — they don't know about check.

import { getMovesForPiece } from "./pieces/index.js";

// Re-exported as-is: this gives every pattern a piece could move in on the
// current board, WITHOUT filtering out moves that would leave your own
// king in check. getLegalMoves() below does that filtering — appropriate
// for an actual move on your turn, but wrong for a premove, where the
// board your move will actually land on doesn't exist yet (the opponent
// hasn't moved). A premove can only be checked against "does this piece
// move this way," not "is my king safe afterward," since that depends on
// a future position nobody can see yet.
export { getMovesForPiece };

export function cloneBoard(board) {
  return board.map((row) => row.map((sq) => (sq ? { ...sq } : null)));
}

export function findKing(board, color) {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = board[r][c];
      if (sq && sq.type === "k" && sq.color === color) return { row: r, col: c };
    }
  }
  return null;
}

/**
 * Is (row, col) attacked by any piece of `byColor`?
 * Reuses each piece's own move generator — a square is "attacked" if that
 * generator would list it as reachable (captures included), regardless of
 * whether a piece actually sits there.
 */
export function isSquareAttacked(board, row, col, byColor) {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece || piece.color !== byColor) continue;
      const moves = getMovesForPiece(board, r, c, piece, {}); // no castling here
      if (moves.some((m) => m.row === row && m.col === col)) return true;
    }
  }
  return false;
}

export function isKingInCheck(board, color) {
  const kingPos = findKing(board, color);
  if (!kingPos) return false;
  const enemy = color === "white" ? "black" : "white";
  return isSquareAttacked(board, kingPos.row, kingPos.col, enemy);
}

/**
 * Applies a move to a board and returns a NEW board (pure, no side effects).
 * Handles en passant capture and castling rook movement.
 */
export function applyMoveToBoard(board, from, to, moveInfo, promotionType = "q") {
  const newBoard = cloneBoard(board);
  const piece = newBoard[from.row][from.col];
  if (!piece) return newBoard;

  if (moveInfo.isEnPassant) {
    const capturedRow = piece.color === "white" ? to.row + 1 : to.row - 1;
    newBoard[capturedRow][to.col] = null;
  }

  if (moveInfo.isCastle === "kingside") {
    const backRank = from.row;
    newBoard[backRank][5] = newBoard[backRank][7];
    newBoard[backRank][7] = null;
  } else if (moveInfo.isCastle === "queenside") {
    const backRank = from.row;
    newBoard[backRank][3] = newBoard[backRank][0];
    newBoard[backRank][0] = null;
  }

  newBoard[to.row][to.col] = moveInfo.isPromotion
    ? { type: promotionType, color: piece.color }
    : piece;
  newBoard[from.row][from.col] = null;

  return newBoard;
}

/**
 * Legal moves for one piece — pseudo-legal moves filtered down to ones that
 * don't leave your own king in check, plus extra castling safety checks.
 */
export function getLegalMoves(board, row, col, piece, extra = {}) {
  const pseudoMoves = getMovesForPiece(board, row, col, piece, extra);
  const enemy = piece.color === "white" ? "black" : "white";
  const legal = [];

  for (const move of pseudoMoves) {
    if (move.isCastle) {
      // King may not castle out of, through, or into check.
      if (isKingInCheck(board, piece.color)) continue;
      const passThroughCol = move.isCastle === "kingside" ? col + 1 : col - 1;
      if (isSquareAttacked(board, row, passThroughCol, enemy)) continue;
      if (isSquareAttacked(board, move.row, move.col, enemy)) continue;
    }

    const resultingBoard = applyMoveToBoard(board, { row, col }, move, move);
    if (!isKingInCheck(resultingBoard, piece.color)) {
      legal.push(move);
    }
  }

  return legal;
}

/**
 * All legal moves for every piece of `color`. Returns an array of
 * { from: {row,col}, piece, move } so callers can check "is there anything
 * this side can do" (checkmate/stalemate) without caring which piece.
 */
export function getAllLegalMoves(board, color, extraByColor = {}) {
  const results = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece || piece.color !== color) continue;
      const extra = extraByColor[color] || {};
      const moves = getLegalMoves(board, r, c, piece, extra);
      for (const move of moves) {
        results.push({ from: { row: r, col: c }, piece, move });
      }
    }
  }
  return results;
}

export function isCheckmate(board, color, extraByColor = {}) {
  return (
    isKingInCheck(board, color) &&
    getAllLegalMoves(board, color, extraByColor).length === 0
  );
}

export function isStalemate(board, color, extraByColor = {}) {
  return (
    !isKingInCheck(board, color) &&
    getAllLegalMoves(board, color, extraByColor).length === 0
  );
}

/** King vs King, King+minor vs King, King+Bishop vs King+Bishop (same color bishops) */
export function hasInsufficientMaterial(board) {
  const pieces = [];
  for (const row of board) {
    for (const sq of row) {
      if (sq && sq.type !== "k") pieces.push(sq);
    }
  }
  if (pieces.length === 0) return true; // king vs king
  if (pieces.length === 1 && ["n", "b"].includes(pieces[0].type)) return true;
  if (
    pieces.length === 2 &&
    pieces.every((p) => p.type === "b") &&
    pieces[0].color !== pieces[1].color
  ) {
    // same-colored-square bishops only — simplified check, good enough for most games
    return true;
  }
  return false;
}

/** Converts board state into a FEN piece-placement string for the AI engine + repetition keys. */
export function boardToFEN(board, turn, castleRights, enPassantTarget, halfmoveClock = 0, fullmoveNumber = 1) {
  const rows = board.map((row) => {
    let fenRow = "";
    let emptyCount = 0;
    for (const square of row) {
      if (!square) {
        emptyCount++;
        continue;
      }
      if (emptyCount > 0) {
        fenRow += emptyCount;
        emptyCount = 0;
      }
      fenRow += square.color === "white" ? square.type.toUpperCase() : square.type;
    }
    if (emptyCount > 0) fenRow += emptyCount;
    return fenRow;
  });

  const placement = rows.join("/");
  const active = turn === "white" ? "w" : "b";

  let castling = "";
  if (!castleRights.white.kingMoved) {
    if (!castleRights.white.rookMoved.kingside) castling += "K";
    if (!castleRights.white.rookMoved.queenside) castling += "Q";
  }
  if (!castleRights.black.kingMoved) {
    if (!castleRights.black.rookMoved.kingside) castling += "k";
    if (!castleRights.black.rookMoved.queenside) castling += "q";
  }
  if (castling === "") castling = "-";

  const files = "abcdefgh";
  const ep = enPassantTarget
    ? `${files[enPassantTarget.col]}${8 - enPassantTarget.row}`
    : "-";

  return `${placement} ${active} ${castling} ${ep} ${halfmoveClock} ${fullmoveNumber}`;
}

/** Inverse of boardToFEN's placement field: FEN string -> 8x8 array of
 * {type, color} | null, with board[0] = rank 8 down to board[7] = rank 1,
 * matching the same row convention boardToFEN expects as input. */
export function parseFEN(fen) {
  const placement = fen.split(" ")[0];
  return placement.split("/").map((rowStr) => {
    const row = [];
    for (const ch of rowStr) {
      if (/\d/.test(ch)) {
        for (let i = 0; i < Number(ch); i++) row.push(null);
      } else {
        row.push({ type: ch.toLowerCase(), color: ch === ch.toUpperCase() ? "white" : "black" });
      }
    }
    return row;
  });
}

/** A shorter key (placement + turn + castling + ep) used purely for threefold-repetition counting. */
export function positionKey(board, turn, castleRights, enPassantTarget) {
  return boardToFEN(board, turn, castleRights, enPassantTarget, 0, 1)
    .split(" ")
    .slice(0, 4)
    .join(" ");
}

const files = "abcdefgh";
export function algebraic(row, col) {
  return `${files[col]}${8 - row}`;
}

/**
 * Basic SAN (Standard Algebraic Notation) for a move, e.g. "Nf3", "exd5", "O-O".
 * Simplification: does not disambiguate two identical pieces that could both
 * reach the same square (rare edge case) — it will just show the plain form.
 */
export function moveToSAN(piece, from, to, moveInfo, { isCheck, isCheckmate } = {}) {
  if (moveInfo.isCastle === "kingside") return isCheckmate ? "O-O#" : isCheck ? "O-O+" : "O-O";
  if (moveInfo.isCastle === "queenside") return isCheckmate ? "O-O-O#" : isCheck ? "O-O-O+" : "O-O-O";

  const pieceLetters = { p: "", n: "N", b: "B", r: "R", q: "Q", k: "K" };
  const destination = algebraic(to.row, to.col);
  const isCapture = moveInfo.isCapture;

  let san;
  if (piece.type === "p") {
    san = isCapture ? `${files[from.col]}x${destination}` : destination;
    if (moveInfo.isPromotion) san += `=Q`; // auto-queen; adjust if you add promotion choice tracking here
  } else {
    san = `${pieceLetters[piece.type]}${isCapture ? "x" : ""}${destination}`;
  }

  if (isCheckmate) san += "#";
  else if (isCheck) san += "+";

  return san;
}
