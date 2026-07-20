import { useState, useEffect, useRef } from "react";
import { Routes, Route, useNavigate, useParams } from "react-router-dom";
import { onAuthStateChanged, signOut } from "firebase/auth";
import Board from "./Board.jsx";
import SpectateBoard from "./SpectateBoard.jsx";
import Auth from "./Auth.jsx";
import Profile from "./Profile.jsx";
import Lobby from "./Lobby.jsx";
import AiSetup from "./AiSetup.jsx";
import Avatar from "./Avatar.jsx";
import NotificationBell from "./NotificationBell.jsx";
import { auth } from "./firebase.js";
import { socket } from "./socket.js";
import { syncProfile } from "./api.js";
import { PIECE_THEMES, DEFAULT_PIECE_THEME, PIECE_THEME_STORAGE_KEY } from "./pieceThemes.js";
import { isSoundEnabled, setSoundEnabled } from "./sound.js";
import "./styles.css";

function loadStoredTheme() {
  try {
    return localStorage.getItem(PIECE_THEME_STORAGE_KEY) || DEFAULT_PIECE_THEME;
  } catch {
    return DEFAULT_PIECE_THEME;
  }
}

export default function App() {
  const [user, setUser] = useState(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [onlineGame, setOnlineGame] = useState(null); // { roomId, color, opponentUsername, opponentPhotoURL }
  const [aiConfig, setAiConfig] = useState(null); // { depth, difficultyLabel, userColor }
  const [pieceTheme, setPieceTheme] = useState(loadStoredTheme);
  const [soundOn, setSoundOn] = useState(isSoundEnabled);
  const navigate = useNavigate();
  const userRef = useRef(user);
  userRef.current = user;

  useEffect(() => {
    // Keeps `user` in sync with Firebase's own session (survives refreshes).
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(
        firebaseUser
          ? {
              uid: firebaseUser.uid,
              username: firebaseUser.displayName || firebaseUser.email,
              photoURL: firebaseUser.photoURL || null,
            }
          : null
      );
      // Ensures this account has a searchable Firestore doc (for the
      // friends feature) even before it's played a stats-eligible game.
      // Force a fresh ID token first: a token cached from earlier in the
      // session can predate a displayName change and would otherwise make
      // the backend see a stale username (e.g. the account's email).
      if (firebaseUser) {
        firebaseUser
          .getIdToken(true)
          .catch(() => {})
          .finally(() => syncProfile().catch(() => {}));

        // Announces "I'm online" for the friends list. Re-announcing on
        // every "connect" event (not just once here) also covers
        // reconnects after a dropped connection, not just the initial
        // page load. The connection is intentionally left open while the
        // app is open (not just during games) — Board.jsx no longer
        // force-disconnects it when leaving a match, precisely so
        // presence stays accurate.
        socket.off("connect");
        socket.on("connect", () => socket.emit("presence:hello", { uid: firebaseUser.uid }));
        socket.connect();
        if (socket.connected) socket.emit("presence:hello", { uid: firebaseUser.uid });
      } else {
        socket.off("connect");
      }
    });
    return unsubscribe;
  }, []);

  // Accepting a challenge from the notification bell (which can be open on
  // ANY screen, not just the menu) needs to end up back here in App so it
  // can set onlineGame + navigate — the bell itself has no route awareness.
  useEffect(() => {
    function onMatchFound({ roomId, color, opponentUsername, opponentPhotoURL, timeControl, matchId }) {
      setOnlineGame({ roomId, color, opponentUsername, opponentPhotoURL, timeControl, matchId });
      navigate(`/online/${roomId}`);
    }
    socket.on("match_found", onMatchFound);
    return () => socket.off("match_found", onMatchFound);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function acceptChallenge(challenge) {
    socket.emit("challenge_response", {
      roomId: challenge.roomId,
      accepted: true,
      username: userRef.current?.username,
      uid: userRef.current?.uid,
      photoURL: userRef.current?.photoURL,
    });
  }

  function declineChallenge(challenge) {
    socket.emit("challenge_response", { roomId: challenge.roomId, accepted: false });
  }

  function choosePieceTheme(themeId) {
    setPieceTheme(themeId);
    try {
      localStorage.setItem(PIECE_THEME_STORAGE_KEY, themeId);
    } catch {
      /* localStorage unavailable (private browsing etc) — theme just won't persist */
    }
  }

  function backToMenu() {
    setOnlineGame(null);
    setAiConfig(null);
    navigate("/");
  }

  function logOut() {
    signOut(auth);
    socket.disconnect();
    setUser(null);
    setAccountMenuOpen(false);
    navigate("/");
  }

  return (
    <>
      {/* Rendered outside <Routes> (fixed-position overlay) so its
          challenge_received/friend_request listeners stay live no matter
          which screen the user is on — previously this only existed inside
          the Menu route, so a challenge sent while the recipient was on
          their Profile page (the actual place the "Challenge" button lives)
          fired into an unmounted component and was silently lost. */}
      {user && (
        <div className="notif-bell-global">
          <NotificationBell user={user} onAcceptChallenge={acceptChallenge} onDeclineChallenge={declineChallenge} />
        </div>
      )}
      <Routes>
        <Route
          path="/"
          element={
            <Menu
              user={user}
              accountMenuOpen={accountMenuOpen}
              setAccountMenuOpen={setAccountMenuOpen}
              onLogin={() => navigate("/login")}
              onProfile={() => {
                navigate("/profile");
                setAccountMenuOpen(false);
              }}
              onLogOut={logOut}
              pieceTheme={pieceTheme}
              choosePieceTheme={choosePieceTheme}
              soundOn={soundOn}
              setSoundOn={setSoundOn}
            />
          }
        />

      <Route
        path="/login"
        element={
          <Auth
            onAuthenticated={(u) => {
              setUser(u);
              navigate("/");
            }}
          />
        }
      />

      <Route
        path="/profile"
        element={
          <Profile
            onBack={() => navigate("/")}
            onProfileUpdated={(patch) => setUser((u) => (u ? { ...u, ...patch } : u))}
            onAccountDeleted={() => {
              signOut(auth);
              socket.disconnect();
              setUser(null);
              navigate("/");
            }}
            onSpectate={(roomId) => navigate(`/spectate/${roomId}`)}
          />
        }
      />

      <Route
        path="/two-players"
        element={
          <GameScreen onExit={backToMenu}>
            <Board mode="local" pieceTheme={pieceTheme} user={user} />
          </GameScreen>
        }
      />

      <Route
        path="/vs-ai"
        element={
          aiConfig ? (
            <GameScreen onExit={backToMenu}>
              <Board
                mode="ai"
                aiUserColor={aiConfig.userColor}
                aiDepth={aiConfig.depth}
                aiDifficultyLabel={aiConfig.difficultyLabel}
                pieceTheme={pieceTheme}
                user={user}
              />
            </GameScreen>
          ) : (
            <AiSetup onBack={backToMenu} onStart={(config) => setAiConfig(config)} />
          )
        }
      />

      <Route
        path="/lobby"
        element={
          <Lobby
            user={user}
            onBack={backToMenu}
            onMatched={({ roomId, color, opponentUsername, opponentPhotoURL, timeControl, matchId }) => {
              setOnlineGame({ roomId, color, opponentUsername, opponentPhotoURL, timeControl, matchId });
              navigate(`/online/${roomId}`);
            }}
          />
        }
      />

      <Route
        path="/online/:roomId"
        element={<OnlineGameRoute onlineGame={onlineGame} pieceTheme={pieceTheme} user={user} onExit={backToMenu} />}
      />

      <Route path="/spectate/:roomId" element={<SpectateRoute pieceTheme={pieceTheme} onExit={backToMenu} />} />
      </Routes>
    </>
  );
}

// A direct link to /online/:roomId without having gone through matchmaking
// (e.g. a hard refresh mid-game) can't rejoin — there's no server-side
// session to restore into, only a live socket handshake from the lobby. In
// that case we just send the person back to the menu instead of showing a
// broken board.
function OnlineGameRoute({ onlineGame, pieceTheme, user, onExit }) {
  const { roomId } = useParams();
  if (!onlineGame || onlineGame.roomId !== roomId) {
    return (
      <div className="menu">
        <p className="menu-tagline">This game session isn't active in this tab.</p>
        <button className="link-btn" onClick={onExit}>
          ← Back to menu
        </button>
      </div>
    );
  }
  return (
    <div className="app">
      <Board
        mode="online"
        roomId={onlineGame.roomId}
        assignedColor={onlineGame.color}
        opponentUsername={onlineGame.opponentUsername}
        opponentPhotoURL={onlineGame.opponentPhotoURL}
        initialSeconds={onlineGame.timeControl}
        matchId={onlineGame.matchId}
        pieceTheme={pieceTheme}
        user={user}
        onExitOnline={onExit}
      />
    </div>
  );
}

function SpectateRoute({ pieceTheme, onExit }) {
  const { roomId } = useParams();
  return (
    <div className="app">
      <button className="back-btn" onClick={onExit}>
        ← Back to menu
      </button>
      <SpectateBoard roomId={roomId} pieceTheme={pieceTheme} />
    </div>
  );
}

function GameScreen({ onExit, children }) {
  return (
    <div className="app">
      <button className="back-btn" onClick={onExit}>
        ← Back to menu
      </button>
      {children}
    </div>
  );
}

function Menu({
  user,
  accountMenuOpen,
  setAccountMenuOpen,
  onLogin,
  onProfile,
  onLogOut,
  pieceTheme,
  choosePieceTheme,
  soundOn,
  setSoundOn,
}) {
  const navigate = useNavigate();

  return (
    <div className="menu">
      <div className="menu-glow" aria-hidden="true" />
      <span className="menu-eyebrow">Real-time · AI · Local</span>
      <h1 className="menu-title">
        <span className="menu-title-icon">♞</span> Knight&apos;s Table
      </h1>
      <p className="menu-tagline">Pick a table. The board is always watching.</p>

      <div className="account-row">
        {user ? (
          <div className="account-menu">
            <button className="account-trigger" onClick={() => setAccountMenuOpen((o) => !o)}>
              <Avatar username={user.username} photoURL={user.photoURL} size={28} />
              <span>{user.username}</span>
            </button>
            {accountMenuOpen && (
              <div className="account-dropdown">
                <button onClick={onProfile}>Profile</button>
                <button onClick={onLogOut}>Log out</button>
              </div>
            )}
          </div>
        ) : (
          <button className="link-btn" onClick={onLogin}>
            Log in / Sign up (optional — saves your games)
          </button>
        )}
      </div>

      <div className="mode-grid">
        <button className="mode-card" onClick={() => navigate("/two-players")}>
          <span className="mode-card-icon">🪑</span>
          <span className="mode-card-title">Two Players</span>
          <span className="mode-card-sub">Same device, pass and play</span>
        </button>

        <button className="mode-card" onClick={() => navigate("/vs-ai")}>
          <span className="mode-card-icon">🤖</span>
          <span className="mode-card-title">Vs AI</span>
          <span className="mode-card-sub">6 difficulties, pick your color</span>
        </button>

        <button className="mode-card mode-card--online" onClick={() => navigate("/lobby")}>
          <span className="mode-card-icon">🌐</span>
          <span className="mode-card-title">Play Online</span>
          <span className="mode-card-sub">Quick match or private room</span>
        </button>
      </div>

      <div className="theme-picker">
        <span className="theme-picker-label">Piece style</span>
        <div className="theme-swatches">
          {PIECE_THEMES.map((t) => (
            <button
              key={t.id}
              className={`theme-swatch ${pieceTheme === t.id ? "selected" : ""}`}
              style={{ "--swatch-a": t.swatch[0], "--swatch-b": t.swatch[1] }}
              onClick={() => choosePieceTheme(t.id)}
              title={t.label}
            >
              <span className="theme-swatch-dot" />
              <span className="theme-swatch-label">{t.label}</span>
            </button>
          ))}
        </div>

        <div className="sound-toggles">
          <button
            className={`sound-toggle ${soundOn ? "selected" : ""}`}
            onClick={() => {
              const next = !soundOn;
              setSoundOn(next);
              setSoundEnabled(next);
            }}
          >
            {soundOn ? "🔊" : "🔇"} Sound
          </button>
        </div>
      </div>
    </div>
  );
}
