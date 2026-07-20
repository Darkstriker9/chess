import { useEffect, useRef, useState } from "react";
import { socket } from "./socket.js";

// Chess.com-style time control presets. Value is seconds per side.
const TIME_CONTROLS = [
  { seconds: 60, label: "1 min", sub: "Bullet" },
  { seconds: 180, label: "3 min", sub: "Blitz" },
  { seconds: 600, label: "10 min", sub: "Rapid" },
];

export default function Lobby({ user, onMatched, onBack }) {
  const [guestName, setGuestName] = useState("");
  const [view, setView] = useState("menu"); // 'menu' | 'searching' | 'hosting' | 'joining'
  const [roomCode, setRoomCode] = useState(null); // code we're hosting
  const [joinInput, setJoinInput] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [timeControl, setTimeControl] = useState(600); // seconds per side, defaults to 10 min
  const activeRoomRef = useRef(null); // room we're currently waiting in (for cancel)

  const username = user?.username || guestName.trim();
  const nameReady = username.length > 0;

  useEffect(() => {
    socket.connect();

    socket.on("searching", ({ roomId }) => {
      activeRoomRef.current = roomId;
      setView("searching");
    });

    socket.on("room_created", ({ roomId }) => {
      activeRoomRef.current = roomId;
      setRoomCode(roomId);
      setView("hosting");
    });

    socket.on("match_found", ({ roomId, color, opponentUsername, opponentPhotoURL, timeControl: matchedTimeControl, matchId }) => {
      activeRoomRef.current = null;
      onMatched({ roomId, color, opponentUsername, opponentPhotoURL, timeControl: matchedTimeControl, matchId });
    });

    socket.on("room_not_found", () => setError("No room found with that code."));
    socket.on("room_full", () => setError("That room already has two players."));

    return () => {
      socket.off("searching");
      socket.off("room_created");
      socket.off("match_found");
      socket.off("room_not_found");
      socket.off("room_full");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startQuickMatch() {
    setError("");
    socket.emit("quick_match", { username, uid: user?.uid, photoURL: user?.photoURL || null, timeControl });
  }

  function createPrivateRoom() {
    setError("");
    socket.emit("create_room", { username, uid: user?.uid, photoURL: user?.photoURL || null, timeControl });
  }

  function joinPrivateRoom() {
    setError("");
    if (!joinInput.trim()) return;
    socket.emit("join_room", { roomId: joinInput.trim(), username, uid: user?.uid, photoURL: user?.photoURL || null });
  }

  function cancel() {
    if (activeRoomRef.current) {
      socket.emit("cancel_search", { roomId: activeRoomRef.current });
      activeRoomRef.current = null;
    }
    setRoomCode(null);
    setView("menu");
  }

  function copyCode() {
    navigator.clipboard?.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="lobby">
      <button className="back-btn" onClick={onBack}>
        ← Back to menu
      </button>

      <h1 className="lobby-title">Play Online</h1>

      {!nameReady && (
        <div className="lobby-name-gate">
          <p>Pick a display name to enter the lobby.</p>
          <input
            placeholder="Your name"
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            maxLength={20}
            autoFocus
          />
        </div>
      )}

      {nameReady && view === "menu" && (
        <div className="lobby-menu">
          <div className="time-control-picker">
            <span className="time-control-label">Time control</span>
            <div className="time-control-options">
              {TIME_CONTROLS.map((tc) => (
                <button
                  key={tc.seconds}
                  type="button"
                  className={`time-control-btn ${timeControl === tc.seconds ? "selected" : ""}`}
                  onClick={() => setTimeControl(tc.seconds)}
                >
                  <span className="time-control-btn-label">{tc.label}</span>
                  <span className="time-control-btn-sub">{tc.sub}</span>
                </button>
              ))}
            </div>
          </div>

          <button className="lobby-card lobby-card--quick" onClick={startQuickMatch}>
            <span className="lobby-card-icon">⚡</span>
            <span className="lobby-card-title">Quick Match</span>
            <span className="lobby-card-sub">Get paired with the next open player</span>
          </button>

          <button className="lobby-card lobby-card--host" onClick={createPrivateRoom}>
            <span className="lobby-card-icon">🛡</span>
            <span className="lobby-card-title">Create Private Room</span>
            <span className="lobby-card-sub">Get a code, invite a friend</span>
          </button>

          <div className="lobby-card lobby-card--join">
            <span className="lobby-card-icon">🔑</span>
            <span className="lobby-card-title">Join Private Room</span>
            <div className="lobby-join-row">
              <input
                placeholder="ROOM CODE"
                value={joinInput}
                onChange={(e) => setJoinInput(e.target.value.toUpperCase())}
                maxLength={5}
              />
              <button disabled={!joinInput.trim()} onClick={joinPrivateRoom}>
                Join
              </button>
            </div>
          </div>

          {error && <p className="lobby-error">{error}</p>}
        </div>
      )}

      {view === "searching" && (
        <div className="lobby-status">
          <div className="lobby-pulse-ring" />
          <p>Searching for an opponent…</p>
          <button className="link-btn" onClick={cancel}>
            Cancel
          </button>
        </div>
      )}

      {view === "hosting" && roomCode && (
        <div className="lobby-status">
          <p className="lobby-hosting-label">Share this code with your friend</p>
          <div className="room-seal">
            <span className="room-seal-code">{roomCode}</span>
          </div>
          <button className="lobby-copy-btn" onClick={copyCode}>
            {copied ? "Copied!" : "Copy code"}
          </button>
          <p className="lobby-time-control-note">
            {TIME_CONTROLS.find((tc) => tc.seconds === timeControl)?.label} game
          </p>
          <div className="lobby-pulse-ring lobby-pulse-ring--small" />
          <p>Waiting for opponent to join…</p>
          <button className="link-btn" onClick={cancel}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
