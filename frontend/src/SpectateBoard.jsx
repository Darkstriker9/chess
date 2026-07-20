import { useEffect, useRef, useState } from "react";
import { parseFEN } from "./chessEngine.js";
import { UNICODE_PIECES } from "./pieces/index.js";
import { socket } from "./socket.js";
import PlayerBar from "./PlayerBar.jsx";
import Chat from "./Chat.jsx";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// Mirrors Board.jsx's own gameOverMessage() so spectators see the exact
// same wording players do, instead of an ad-hoc status line.
function gameOverMessage(gameOver) {
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

// A read-only view of a live game, built as its own component rather than
// threading a "spectate" branch through every piece of Board.jsx's move
// logic — a spectator never validates or plays a move, it just mirrors
// whatever FEN the server broadcasts, so it doesn't need any of that.
export default function SpectateBoard({ roomId, pieceTheme = "classic" }) {
  const [fen, setFen] = useState(START_FEN);
  const [players, setPlayers] = useState([]); // [{ username, photoURL, color }]
  const [notFound, setNotFound] = useState(false);
  const [gameOver, setGameOver] = useState(null); // { reason, winner } | null
  const joinedRef = useRef(false);

  useEffect(() => {
    function onJoined(data) {
      setFen(data.fen || START_FEN);
      setPlayers(data.players || []);
      joinedRef.current = true;
    }
    function onNotFound() {
      setNotFound(true);
    }
    function onMove({ fen }) {
      setFen(fen);
    }
    function onResigned({ winner } = {}) {
      setGameOver((prev) => prev || { reason: "resignation", winner: winner || null });
    }
    function onLeft({ winner } = {}) {
      setGameOver((prev) => prev || { reason: "opponent-left", winner: winner || null });
    }
    function onDrawResponse({ accepted }) {
      if (accepted) setGameOver((prev) => prev || { reason: "draw-agreed", winner: null });
    }
    // Covers checkmate, stalemate, insufficient material, threefold
    // repetition, the 50-move rule, and flag-fall — reasons only a
    // player's own chess engine detects, relayed here by the server so a
    // spectator (which has no engine of its own) sees the same result.
    function onGameResult({ reason, winner } = {}) {
      if (!reason) return;
      setGameOver((prev) => prev || { reason, winner: winner || null });
    }

    socket.emit("spectate_room", { roomId });
    socket.on("spectate_joined", onJoined);
    socket.on("spectate_room_not_found", onNotFound);
    socket.on("opponent_move", onMove);
    socket.on("opponent_resigned", onResigned);
    socket.on("opponent_left", onLeft);
    socket.on("draw_response", onDrawResponse);
    socket.on("game_result", onGameResult);

    return () => {
      socket.emit("leave_spectate");
      socket.off("spectate_joined", onJoined);
      socket.off("spectate_room_not_found", onNotFound);
      socket.off("opponent_move", onMove);
      socket.off("opponent_resigned", onResigned);
      socket.off("opponent_left", onLeft);
      socket.off("draw_response", onDrawResponse);
      socket.off("game_result", onGameResult);
    };
  }, [roomId]);

  if (notFound) {
    return <p className="menu-tagline">That game isn't active anymore.</p>;
  }

  const board = parseFEN(fen);
  const white = players.find((p) => p.color === "white");
  const black = players.find((p) => p.color === "black");

  return (
    <div className="game-layout">
      <div className="chess-wrapper">
        <div className="status-bar">
          <span className="turn-pill">👁 Spectating</span>
        </div>

        <div className="player-row">
          <PlayerBar name={black?.username || "Black"} photoURL={black?.photoURL} captured={[]} materialLead={0} isActive={false} />
        </div>

        <div className="board-frame">
          <div className={`chess-board theme-${pieceTheme}`}>
            {board.map((row, r) =>
              row.map((piece, c) => (
                <div key={`${r}-${c}`} className={["square", (r + c) % 2 === 0 ? "light" : "dark"].join(" ")}>
                  {piece && <span className={`piece ${piece.color}`}>{UNICODE_PIECES[piece.color][piece.type]}</span>}
                </div>
              ))
            )}
          </div>

          {gameOver && (
            <div className="board-overlay">
              <div className="game-over-banner">{gameOverMessage(gameOver)}</div>
            </div>
          )}
        </div>

        <div className="player-row">
          <PlayerBar name={white?.username || "White"} photoURL={white?.photoURL} captured={[]} materialLead={0} isActive={false} />
        </div>
      </div>

      <Chat roomId={roomId} canSend={false} />
    </div>
  );
}
