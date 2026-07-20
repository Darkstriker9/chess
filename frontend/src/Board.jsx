import { useEffect, useRef, useState } from "react";
import { createInitialBoard, UNICODE_PIECES } from "./pieces/index.js";
import {
  getLegalMoves,
  getAllLegalMoves,
  applyMoveToBoard,
  isKingInCheck,
  hasInsufficientMaterial,
  boardToFEN,
  positionKey,
  moveToSAN,
} from "./chessEngine.js";
import { socket } from "./socket.js";
import { getAIMove, saveGame } from "./api.js";
import { playMove, playCapture, playCheck, playGameEnd } from "./sound.js";
import PromotionModal from "./PromotionModal.jsx";
import MoveHistory from "./MoveHistory.jsx";
import Clock from "./Clock.jsx";
import PlayerBar from "./PlayerBar.jsx";
import GameReview from "./GameReview.jsx";
import Chat from "./Chat.jsx";

const STARTING_SECONDS = 10 * 60; // 10 minute clocks
const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

const initialCastleRights = () => ({
  white: { kingMoved: false, rookMoved: { queenside: false, kingside: false } },
  black: { kingMoved: false, rookMoved: { queenside: false, kingside: false } },
});

export default function Board({
  mode,
  roomId,
  user,
  assignedColor,
  opponentUsername,
  opponentPhotoURL,
  onExitOnline,
  aiUserColor = "white",
  aiDepth = 12,
  aiDifficultyLabel = "AI",
  pieceTheme = "classic",
  initialSeconds = STARTING_SECONDS,
}) {
  const [board, setBoard] = useState(createInitialBoard());
  const [turn, setTurn] = useState("white");
  const [selected, setSelected] = useState(null);
  const [legalMoves, setLegalMoves] = useState([]);
  const [enPassantTarget, setEnPassantTarget] = useState(null);
  const [castleRights, setCastleRights] = useState(initialCastleRights());
  const [myColor, setMyColor] = useState(assignedColor || "white");
  const [status, setStatus] = useState("");
  const [moveHistory, setMoveHistory] = useState([]); // SAN strings
  const [uciHistory, setUciHistory] = useState([]); // "e2e4"-style strings, same order as moveHistory
  const [fenHistory, setFenHistory] = useState(() => [
    boardToFEN(createInitialBoard(), "white", initialCastleRights(), null, 0, 1),
  ]); // fenHistory[i] = position AFTER move i (fenHistory[0] = starting position)
  const [halfmoveClock, setHalfmoveClock] = useState(0);
  const [fullmoveNumber, setFullmoveNumber] = useState(1);
  const [positionCounts, setPositionCounts] = useState({});
  const [gameOver, setGameOver] = useState(null); // { reason, winner } | null
  const [showReview, setShowReview] = useState(false);
  const [pendingPromotion, setPendingPromotion] = useState(null); // { from, to, moveInfo }
  const [clocks, setClocks] = useState({ white: initialSeconds, black: initialSeconds });
  // Pieces captured BY each color — e.g. capturedBy.white holds the
  // (black-colored) pieces white has taken, for the captured-pieces strip
  // under each player's name.
  const [capturedBy, setCapturedBy] = useState({ white: [], black: [] });
  const savedRef = useRef(false);

  // Always-current snapshot of game state. commitMove reads from this
  // instead of the render-closed state variables above, because it can be
  // invoked from long-lived callbacks (the socket "opponent_move"
  // listener) that were registered on an earlier render and would
  // otherwise operate on stale board/turn values — which previously
  // caused the board to desync and lock up after an opponent's move.
  const stateRef = useRef();
  stateRef.current = { board, turn, castleRights, enPassantTarget, halfmoveClock, fullmoveNumber };

  // ---- Clocks tick down for whoever's turn it is ----
  useEffect(() => {
    if (gameOver) return;
    const interval = setInterval(() => {
      setClocks((prev) => {
        const next = { ...prev, [turn]: Math.max(0, prev[turn] - 1) };
        if (next[turn] === 0) {
          setGameOver({ reason: "flag-fall", winner: turn === "white" ? "black" : "white" });
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [turn, gameOver]);

  // ---- Online multiplayer wiring ----
  // Room joining and color assignment already happened in the Lobby — this
  // effect just keeps moves in sync once the game is underway.
  const [drawOfferSent, setDrawOfferSent] = useState(false);
  const [incomingDrawOffer, setIncomingDrawOffer] = useState(false);

  useEffect(() => {
    if (mode !== "online") return;

    setStatus(`You are playing ${assignedColor}. Opponent: ${opponentUsername || "..."}`);

    socket.on("opponent_move", ({ move }) => {
      commitMove(move.from, move.to, move, move.promotionType || "q", true);
    });

    socket.on("opponent_left", ({ winner } = {}) => {
      setStatus("Your opponent left the game — you win!");
      setGameOver((prev) => prev || { reason: "opponent-left", winner: winner || myColor });
    });

    socket.on("opponent_resigned", ({ winner } = {}) => {
      setGameOver((prev) => prev || { reason: "resignation", winner: winner || myColor });
    });

    socket.on("draw_offered", () => setIncomingDrawOffer(true));

    socket.on("draw_response", ({ accepted }) => {
      setDrawOfferSent(false);
      if (accepted) {
        setGameOver((prev) => prev || { reason: "draw-agreed", winner: null });
      } else {
        setStatus("Your draw offer was declined.");
      }
    });

    return () => {
      socket.off("opponent_move");
      socket.off("opponent_left");
      socket.off("opponent_resigned");
      socket.off("draw_offered");
      socket.off("draw_response");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, roomId]);

  // Tell the server this game reached a normal conclusion, so leaving
  // afterwards (e.g. clicking "Leave game" once it's over) never counts as
  // an abandon-loss on top of the real result.
  useEffect(() => {
    if (mode === "online" && gameOver) {
      // Relays the reason/winner this client already worked out (checkmate,
      // stalemate, flag-fall, etc.) so the server can pass it along to any
      // spectators, who have no chess engine of their own to detect it.
      socket.emit("game_over", { roomId, reason: gameOver.reason, winner: gameOver.winner });
    }
  }, [mode, gameOver, roomId]);

  function leaveOnlineGame() {
    if (!gameOver) {
      const confirmed = window.confirm(
        "Leave this game? Since it hasn't finished yet, this will count as a loss."
      );
      if (!confirmed) return;
    }
    socket.emit("leave_room");
    // Note: intentionally NOT calling socket.disconnect() here — the
    // connection stays open for presence (friends' online/offline status)
    // even after leaving a game. It's only closed on logout.
    onExitOnline?.();
  }

  // "myPlayingColor" is whichever color represents the human sitting at
  // this browser: your assigned color online, or your chosen color vs AI.
  // Local two-player mode has no single such color, so resign/draw there
  // are per-side instead (see resignSide).
  const myPlayingColor = mode === "online" ? myColor : mode === "ai" ? aiUserColor : null;

  function resign() {
    if (gameOver || !myPlayingColor) return;
    if (!window.confirm("Resign this game? This will count as a loss.")) return;
    const winner = myPlayingColor === "white" ? "black" : "white";
    setGameOver({ reason: "resignation", winner });
    if (mode === "online") socket.emit("resign", { roomId });
  }

  function resignSide(side) {
    if (gameOver) return;
    if (!window.confirm(`${side === "white" ? "White" : "Black"} resigns — end the game?`)) return;
    setGameOver({ reason: "resignation", winner: side === "white" ? "black" : "white" });
  }

  function offerOrAgreeDraw() {
    if (gameOver) return;
    if (mode === "online") {
      if (drawOfferSent) return;
      setDrawOfferSent(true);
      setStatus("Draw offer sent to your opponent.");
      socket.emit("offer_draw", { roomId });
    } else {
      if (!window.confirm("End the game as a draw?")) return;
      setGameOver({ reason: "draw-agreed", winner: null });
    }
  }

  function respondToDraw(accepted) {
    setIncomingDrawOffer(false);
    socket.emit("draw_response", { roomId, accepted });
    if (accepted) {
      setGameOver((prev) => prev || { reason: "draw-agreed", winner: null });
    }
  }

  function commitMove(from, to, moveInfo, promotionType = "q", fromRemote = false) {
    const { board, turn, castleRights, halfmoveClock, fullmoveNumber } = stateRef.current;
    const piece = board[from.row][from.col];
    if (!piece) return;

    // Figure out what (if anything) this move captures BEFORE the board
    // changes, so it can be added to that piece's "captured by" strip.
    let capturedPiece = null;
    if (moveInfo.isEnPassant) {
      const capturedRow = piece.color === "white" ? to.row + 1 : to.row - 1;
      capturedPiece = board[capturedRow][to.col];
    } else if (moveInfo.isCapture) {
      capturedPiece = board[to.row][to.col];
    }

    const newBoard = applyMoveToBoard(board, from, to, moveInfo, promotionType);
    const nextTurn = turn === "white" ? "black" : "white";

    // Update castling rights
    const newCastleRights = structuredClone(castleRights);
    if (piece.type === "k") newCastleRights[piece.color].kingMoved = true;
    if (piece.type === "r") {
      if (from.col === 0) newCastleRights[piece.color].rookMoved.queenside = true;
      if (from.col === 7) newCastleRights[piece.color].rookMoved.kingside = true;
    }

    // En passant target for the NEXT move
    let newEnPassant = null;
    if (piece.type === "p" && Math.abs(to.row - from.row) === 2) {
      newEnPassant = { row: (from.row + to.row) / 2, col: from.col };
    }

    // 50-move rule counter
    const isPawnMoveOrCapture = piece.type === "p" || moveInfo.isCapture;
    const newHalfmove = isPawnMoveOrCapture ? 0 : halfmoveClock + 1;
    const newFullmove = turn === "black" ? fullmoveNumber + 1 : fullmoveNumber;

    const opponentInCheck = isKingInCheck(newBoard, nextTurn);
    const isMate = isCheckmateSafe(newBoard, nextTurn, newEnPassant, newCastleRights);
    const isStale = !isMate && isStalemateSafe(newBoard, nextTurn, newEnPassant, newCastleRights);

    const san = moveToSAN(piece, from, to, moveInfo, { isCheck: opponentInCheck && !isMate, isCheckmate: isMate });

    // "e2e4"-style string for this move, matching the UCI format the
    // chess engine API uses — needed later to check whether a played
    // move matches the engine's top choice during post-game review.
    const files = "abcdefgh";
    const uci =
      `${files[from.col]}${8 - from.row}${files[to.col]}${8 - to.row}` +
      (moveInfo.isPromotion ? promotionType : "");

    const newFen = boardToFEN(newBoard, nextTurn, newCastleRights, newEnPassant, newHalfmove, newFullmove);

    setBoard(newBoard);
    setCastleRights(newCastleRights);
    setEnPassantTarget(newEnPassant);
    setHalfmoveClock(newHalfmove);
    setFullmoveNumber(newFullmove);
    setMoveHistory((h) => [...h, san]);
    setUciHistory((h) => [...h, uci]);
    setFenHistory((h) => [...h, newFen]);
    setTurn(nextTurn);
    setSelected(null);
    setLegalMoves([]);

    if (capturedPiece) {
      setCapturedBy((prev) => ({ ...prev, [piece.color]: [...prev[piece.color], capturedPiece] }));
      playCapture();
    } else {
      playMove();
    }
    if (opponentInCheck && !isMate) playCheck();

    const key = positionKey(newBoard, nextTurn, newCastleRights, newEnPassant);
    setPositionCounts((prev) => {
      const updated = { ...prev, [key]: (prev[key] || 0) + 1 };
      if (updated[key] >= 3) {
        setGameOver({ reason: "threefold-repetition", winner: null });
      }
      return updated;
    });

    if (newHalfmove >= 100) {
      setGameOver({ reason: "fifty-move-rule", winner: null });
    } else if (isMate) {
      setGameOver({ reason: "checkmate", winner: turn }); // the side that just moved wins
    } else if (isStale) {
      setGameOver({ reason: "stalemate", winner: null });
    } else if (hasInsufficientMaterial(newBoard)) {
      setGameOver({ reason: "insufficient-material", winner: null });
    }

    if (!fromRemote && mode === "online") {
      socket.emit("make_move", { roomId, move: { from, to, ...moveInfo, promotionType }, fen: newFen });
    }
  }

  function isCheckmateSafe(bd, color, epTarget, cr) {
    return isKingInCheck(bd, color) && getAllLegalMoves(bd, color, { [color]: { enPassantTarget: epTarget, castleRights: cr[color] } }).length === 0;
  }
  function isStalemateSafe(bd, color, epTarget, cr) {
    return !isKingInCheck(bd, color) && getAllLegalMoves(bd, color, { [color]: { enPassantTarget: epTarget, castleRights: cr[color] } }).length === 0;
  }

  // ---- AI move fetch (AI plays whichever color the user didn't pick) ----
  const [aiError, setAiError] = useState(null);
  const [aiRetryTick, setAiRetryTick] = useState(0);
  const aiColor = aiUserColor === "white" ? "black" : "white";

  useEffect(() => {
    if (mode !== "ai" || turn !== aiColor || gameOver) return;

    let cancelled = false;
    const fen = boardToFEN(board, turn, castleRights, enPassantTarget, halfmoveClock, fullmoveNumber);

    (async () => {
      setAiError(null);
      setStatus("AI is thinking...");
      try {
        const data = await getAIMove(fen, aiDepth);
        if (cancelled) return;
        setStatus("");

        const files = "abcdefgh";
        const from = { col: files.indexOf(data.move[0]), row: 8 - parseInt(data.move[1], 10) };
        const to = { col: files.indexOf(data.move[2]), row: 8 - parseInt(data.move[3], 10) };
        const promoChar = data.move[4]; // e.g. "e7e8q"
        const piece = board[from.row][from.col];
        const moves = getLegalMoves(board, from.row, from.col, piece, {
          enPassantTarget,
          castleRights: castleRights[piece.color],
        });
        const moveInfo = moves.find((m) => m.row === to.row && m.col === to.col) || {
          isCapture: !!board[to.row][to.col],
        };
        commitMove(from, to, moveInfo, promoChar || "q");
      } catch (err) {
        if (cancelled) return;
        console.error("AI move fetch failed:", err);
        setStatus("");
        setAiError(err.message || "The AI engine failed to respond.");
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn, mode, gameOver, aiRetryTick]);

  // ---- Play a sound when the game ends ----
  useEffect(() => {
    if (!gameOver) return;
    const perspective = mode === "online" ? myColor : mode === "ai" ? aiUserColor : null;
    if (!gameOver.winner) {
      playGameEnd("draw");
    } else if (!perspective) {
      playGameEnd("neutral");
    } else {
      playGameEnd(gameOver.winner === perspective ? "win" : "loss");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameOver]);

  // ---- Save finished game to backend once ----
  useEffect(() => {
    if (!gameOver || savedRef.current) return;
    savedRef.current = true;

    let result = "1/2-1/2";
    if (gameOver.winner === "white") result = "1-0";
    if (gameOver.winner === "black") result = "0-1";

    const playerColor = mode === "online" ? myColor : mode === "ai" ? aiUserColor : null;

    saveGame({
      roomId: roomId || "local",
      pgn: moveHistory.join(" "),
      result,
      playerColor,
      countsForStats: mode === "online",
      whiteUsername:
        mode === "online"
          ? myColor === "white"
            ? user?.username
            : opponentUsername
          : mode === "ai"
            ? aiUserColor === "white"
              ? user?.username
              : "Stockfish AI"
            : user?.username,
      blackUsername:
        mode === "online"
          ? myColor === "black"
            ? user?.username
            : opponentUsername
          : mode === "ai"
            ? aiUserColor === "black"
              ? user?.username
              : "Stockfish AI"
            : undefined,
    }).catch(() => {
      /* saving is best-effort; don't block the UI on failure */
    });
  }, [gameOver]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSquareClick(row, col) {
    if (gameOver || pendingPromotion) return;
    if (mode === "online" && turn !== myColor) return;
    if (mode === "ai" && turn !== aiUserColor) return;

    const piece = board[row][col];

    if (selected) {
      const move = legalMoves.find((m) => m.row === row && m.col === col);
      if (move) {
        if (move.isPromotion) {
          setPendingPromotion({ from: selected, to: { row, col }, moveInfo: move });
        } else {
          commitMove(selected, { row, col }, move);
        }
        return;
      }
      if (piece && piece.color === turn) {
        selectSquare(row, col, piece);
      } else {
        setSelected(null);
        setLegalMoves([]);
      }
      return;
    }

    if (piece && piece.color === turn) {
      selectSquare(row, col, piece);
    }
  }

  function selectSquare(row, col, piece) {
    const moves = getLegalMoves(board, row, col, piece, {
      enPassantTarget,
      castleRights: castleRights[piece.color],
    });
    setSelected({ row, col });
    setLegalMoves(moves);
  }

  function handlePromotionChoice(type) {
    const { from, to, moveInfo } = pendingPromotion;
    setPendingPromotion(null);
    commitMove(from, to, moveInfo, type);
  }

  const isLight = (row, col) => (row + col) % 2 === 0;
  const isLegalTarget = (row, col) => legalMoves.some((m) => m.row === row && m.col === col);
  const inCheckNow = isKingInCheck(board, turn);

  function findKingSquare(color) {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (board[r][c]?.type === "k" && board[r][c]?.color === color) return { r, c };
      }
    }
    return null;
  }
  const checkedKingSquare = inCheckNow && !gameOver ? findKingSquare(turn) : null;

  // Flip the board so the human's own pieces are always at the bottom —
  // otherwise a player who chose black would see their own back rank at
  // the top, which is disorienting.
  const orientation = mode === "online" ? myColor : mode === "ai" ? aiUserColor : "white";
  const flipped = orientation === "black";
  const rowOrder = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
  const colOrder = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
  const displayRanks = flipped ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
  const displayFiles = flipped ? "hgfedcba" : "abcdefgh";

  const bottomColor = orientation;
  const topColor = bottomColor === "white" ? "black" : "white";

  function playerInfo(color) {
    if (mode === "online") {
      if (color === myColor) return { name: user?.username || "You", photoURL: user?.photoURL };
      return { name: opponentUsername || "Opponent", photoURL: opponentPhotoURL || null };
    }
    if (mode === "ai") {
      if (color === aiUserColor) return { name: user?.username || "You", photoURL: user?.photoURL };
      return { name: `Stockfish (${aiDifficultyLabel})`, photoURL: null };
    }
    return { name: color === "white" ? "White" : "Black", photoURL: null };
  }

  const capturedValue = (color) => capturedBy[color].reduce((sum, p) => sum + PIECE_VALUE[p.type], 0);
  const materialLead = {
    white: Math.max(0, capturedValue("white") - capturedValue("black")),
    black: Math.max(0, capturedValue("black") - capturedValue("white")),
  };

  const topInfo = playerInfo(topColor);
  const bottomInfo = playerInfo(bottomColor);

  function gameOverMessage() {
    if (!gameOver) return null;
    const { reason, winner } = gameOver;
    if (reason === "draw-agreed") return "Draw agreed";
    const winnerText = winner ? `${winner[0].toUpperCase()}${winner.slice(1)} wins` : "Draw";
    const reasonText = {
      checkmate: "by checkmate",
      "flag-fall": "on time",
      stalemate: "— stalemate",
      "insufficient-material": "— insufficient material",
      "fifty-move-rule": "— 50-move rule",
      "threefold-repetition": "— threefold repetition",
      "opponent-left": "— opponent left the game",
      resignation: "by resignation",
      "draw-agreed": "— draw agreed",
    }[reason];
    return `${winnerText} ${reasonText}`;
  }

  return (
    <div className="game-layout">
      <div className="chess-wrapper">
        <div className="status-bar">
          <span className={`turn-pill turn-${turn}`}>
            <span className="turn-dot" /> {turn === "white" ? "White" : "Black"} to move
          </span>
          {inCheckNow && !gameOver && <span className="check-msg">Check!</span>}
          {status && <span className="status-msg">{status}</span>}
        </div>

        <div className="player-row">
          <PlayerBar
            name={topInfo.name}
            photoURL={topInfo.photoURL}
            captured={capturedBy[topColor]}
            materialLead={materialLead[topColor]}
            isActive={turn === topColor && !gameOver}
          />
          <Clock
            label={topColor === "white" ? "White" : "Black"}
            seconds={clocks[topColor]}
            isActive={turn === topColor && !gameOver}
            flagged={clocks[topColor] === 0}
          />
        </div>

        <div className="board-frame">
          <div className="rank-coords">
            {displayRanks.map((n) => (
              <span key={n} className="rank-coord">
                {n}
              </span>
            ))}
          </div>

          <div className={`chess-board theme-${pieceTheme}`}>
            {rowOrder.map((row) =>
              colOrder.map((col) => {
                const piece = board[row][col];
                const isCapture = isLegalTarget(row, col) && piece;
                return (
                  <div
                    key={`${row}-${col}`}
                    className={[
                      "square",
                      isLight(row, col) ? "light" : "dark",
                      selected?.row === row && selected?.col === col ? "selected" : "",
                      isLegalTarget(row, col) ? (isCapture ? "capture-target" : "legal-target") : "",
                      checkedKingSquare?.r === row && checkedKingSquare?.c === col ? "king-in-check" : "",
                    ].join(" ")}
                    onClick={() => handleSquareClick(row, col)}
                  >
                    {piece && (
                      <span className={`piece ${piece.color}`}>
                        {UNICODE_PIECES[piece.color][piece.type]}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div className="file-coords">
            {displayFiles.split("").map((f) => (
              <span key={f} className="file-coord">
                {f}
              </span>
            ))}
          </div>

          {gameOver && (
            <div className="board-overlay">
              <div className="game-over-banner">
                {gameOverMessage()}
                {mode !== "ai" && moveHistory.length > 0 && (
                  <button className="review-btn" onClick={() => setShowReview(true)}>
                    Game Review
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="player-row">
          <PlayerBar
            name={bottomInfo.name}
            photoURL={bottomInfo.photoURL}
            captured={capturedBy[bottomColor]}
            materialLead={materialLead[bottomColor]}
            isActive={turn === bottomColor && !gameOver}
          />
          <Clock
            label={bottomColor === "white" ? "White" : "Black"}
            seconds={clocks[bottomColor]}
            isActive={turn === bottomColor && !gameOver}
            flagged={clocks[bottomColor] === 0}
          />
        </div>

        {incomingDrawOffer && !gameOver && (
          <div className="draw-offer-banner">
            <span>Your opponent offers a draw.</span>
            <div className="draw-offer-actions">
              <button onClick={() => respondToDraw(true)}>Accept</button>
              <button onClick={() => respondToDraw(false)}>Decline</button>
            </div>
          </div>
        )}

        {!gameOver && mode === "ai" && (
          <div className="board-controls">
            <button className="control-btn control-btn--resign" onClick={resign}>
              Resign
            </button>
          </div>
        )}

        {!gameOver && mode === "online" && (
          <div className="board-controls">
            <button className="control-btn control-btn--resign" onClick={resign}>
              Resign
            </button>
            <button className="control-btn" onClick={offerOrAgreeDraw} disabled={drawOfferSent}>
              {drawOfferSent ? "Draw offer sent..." : "Offer Draw"}
            </button>
          </div>
        )}

        {!gameOver && mode === "local" && (
          <div className="board-controls">
            <button className="control-btn control-btn--resign" onClick={() => resignSide("white")}>
              White resigns
            </button>
            <button className="control-btn" onClick={offerOrAgreeDraw}>
              Draw
            </button>
            <button className="control-btn control-btn--resign" onClick={() => resignSide("black")}>
              Black resigns
            </button>
          </div>
        )}

        {mode === "online" && (
          <button className="link-btn leave-btn" onClick={leaveOnlineGame}>
            {gameOver ? "Back to menu" : "Leave game"}
          </button>
        )}

        {aiError && (
          <div className="ai-error-banner">
            <span>{aiError}</span>
            <button onClick={() => setAiRetryTick((t) => t + 1)}>Retry</button>
          </div>
        )}
      </div>

      <MoveHistory moves={moveHistory} />

      {mode === "online" && <Chat roomId={roomId} />}

      {pendingPromotion && (
        <PromotionModal color={turn} onChoose={handlePromotionChoice} />
      )}

      {showReview && (
        <GameReview
          fenHistory={fenHistory}
          sanMoves={moveHistory}
          uciMoves={uciHistory}
          whitePlayer={playerInfo("white")}
          blackPlayer={playerInfo("black")}
          pieceTheme={pieceTheme}
          onClose={() => setShowReview(false)}
        />
      )}
    </div>
  );
}
