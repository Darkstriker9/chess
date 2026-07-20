import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import aiMoveRouter from "./routes/aiMove.js";
import gamesRouter from "./routes/games.js";
import profileRouter from "./routes/profile.js";
import friendsRouter from "./routes/friends.js";
import analyzeGameRouter from "./routes/analyzeGame.js";
import { bumpUserStats } from "./stats.js";
import { markOnline, markOffline, setUserRoom, getUserRoom, setIO, notifyUser } from "./presence.js";
import { isConfigured as isDbConfigured } from "./db.js";
import { randomUUID } from "node:crypto";

const app = express();
const server = http.createServer(app);

// CLIENT_ORIGIN can be a single URL or a comma-separated list — handy on
// Vercel, where you'll typically want both your production domain and any
// preview-deployment URLs (which change per-branch/PR) to be allowed.
// e.g. CLIENT_ORIGIN=https://your-app.vercel.app,https://your-app-git-main-you.vercel.app
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

function isAllowedOrigin(origin) {
  // No Origin header (server-to-server calls, curl, etc.) — allow through;
  // browsers always send Origin for cross-site requests, so this doesn't
  // weaken same-site protection.
  if (!origin) return true;
  return CLIENT_ORIGINS.includes(origin);
}

const corsOptions = {
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) callback(null, true);
    else callback(new Error("Not allowed by CORS"));
  },
};

app.use(cors(corsOptions));
app.use(express.json());

// REST endpoint for AI moves (keeps the engine API key server-side)
app.use("/api", aiMoveRouter);
app.use("/api/games", gamesRouter);
app.use("/api/profile", profileRouter);
app.use("/api/friends", friendsRouter);
app.use("/api/analyze-game", analyzeGameRouter);

app.get("/health", (req, res) => res.json({ ok: true }));

// ---- Socket.io: online real-time multiplayer ----
const io = new Server(server, {
  cors: corsOptions,
});
setIO(io);

// rooms: Map<roomId, {
//   isPrivate: boolean,
//   status: 'waiting' | 'playing' | 'finished',
//   players: [{ socketId, uid, username, photoURL, color }],
//   spectatorSocketIds: Set<string>,
//   fen: string | null,
// }>
const rooms = new Map();

// Room codes are short, human-shareable, and avoid ambiguous characters
// (0/O, 1/I) — the same idea as a game lobby invite code.
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateRoomCode() {
  let code;
  do {
    code = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
  } while (rooms.has(code));
  return code;
}

// Supported time controls (in seconds per side), chess.com-style presets.
// Anything else sent by a client falls back to the 10-minute default.
const TIME_CONTROLS = [60, 180, 600];
const DEFAULT_TIME_CONTROL = 600;
function normalizeTimeControl(seconds) {
  return TIME_CONTROLS.includes(seconds) ? seconds : DEFAULT_TIME_CONTROL;
}

// A player who disconnects/leaves mid-game (status was still "playing",
// meaning both sides had joined and the game hadn't reached a normal
// conclusion yet) is credited a loss directly — their client is gone, so
// it can't make the authenticated save-game call itself. The remaining
// player's own client independently saves a win for themselves the normal
// way once it sees "opponent_left".
// Once a game genuinely ends (checkmate, resignation, draw, timeout, or one
// side abandoning it), both players stop "being in a room" as far as the
// friends list / presence system is concerned — otherwise they'd stay
// pinned to a finished game forever and every friend would only ever see a
// stale "Watch" button for them instead of "Challenge".  The room object
// itself is left alone so anyone already spectating still sees the final
// position and result.
function clearRoomPresence(room) {
  if (!room) return;
  for (const p of room.players) {
    if (p.uid) setUserRoom(p.uid, null);
  }
}

function leaveAnyRoom(socket) {
  for (const [roomId, room] of rooms) {
    const idx = room.players.findIndex((p) => p.socketId === socket.id);
    if (idx === -1) continue;

    const [leavingPlayer] = room.players.splice(idx, 1);
    socket.leave(roomId);
    if (leavingPlayer.uid) setUserRoom(leavingPlayer.uid, null);

    const wasMidGame = room.status === "playing";

    if (room.players.length === 0) {
      rooms.delete(roomId);
    } else if (wasMidGame) {
      room.status = "finished"; // prevents the remaining player's later "leave" from also being punished
      clearRoomPresence(room); // the remaining player is no longer "in a game" either
      // Include the winner's color so spectators (who have no notion of
      // "opponent") can render the same result banner the remaining
      // player sees, instead of just a plain status line.
      io.to(roomId).emit("opponent_left", { winner: room.players[0]?.color || null });
    } else {
      room.status = "waiting";
    }

    if (wasMidGame && leavingPlayer.uid) {
      bumpUserStats(leavingPlayer.uid, leavingPlayer.username, "loss").catch((err) =>
        console.error("Failed to record abandon-loss:", err)
      );
    }
  }
}

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Presence: lets the friends list show who's currently online. Sent
  // once by any logged-in client as soon as it connects (not tied to
  // being in a chess room — just "the app is open").
  socket.on("presence:hello", ({ uid } = {}) => {
    if (!uid) return;
    socket.data.presenceUid = uid;
    markOnline(uid, socket.id);
  });

  // ---- Quick match: pair with the first open public room, or open one ----
  // Players are only paired up if they picked the same time control —
  // otherwise a 1-minute bullet player could get dropped into someone
  // else's 10-minute game.
  socket.on("quick_match", ({ username, uid, photoURL, timeControl } = {}) => {
    leaveAnyRoom(socket);
    const wantedTimeControl = normalizeTimeControl(timeControl);

    const openRoom = [...rooms.values()].find(
      (r) => !r.isPrivate && r.status === "waiting" && r.players.length === 1 && r.timeControlSeconds === wantedTimeControl
    );

    if (openRoom) {
      const roomId = [...rooms.entries()].find(([, r]) => r === openRoom)[0];
      const host = openRoom.players[0];
      openRoom.players.push({
        socketId: socket.id,
        uid: uid || null,
        username: username || "Guest",
        photoURL: photoURL || null,
        color: "black",
      });
      openRoom.status = "playing";
      socket.join(roomId);
      setUserRoom(uid, roomId);
      setUserRoom(host.uid, roomId);

      socket.emit("match_found", {
        roomId,
        color: "black",
        opponentUsername: host.username,
        opponentPhotoURL: host.photoURL || null,
        timeControl: openRoom.timeControlSeconds,
        matchId: openRoom.matchId,
      });
      io.to(host.socketId).emit("match_found", {
        roomId,
        color: "white",
        opponentUsername: username || "Guest",
        opponentPhotoURL: photoURL || null,
        timeControl: openRoom.timeControlSeconds,
        matchId: openRoom.matchId,
      });
      return;
    }

    const roomId = generateRoomCode();
    rooms.set(roomId, {
      isPrivate: false,
      status: "waiting",
      players: [
        { socketId: socket.id, uid: uid || null, username: username || "Guest", photoURL: photoURL || null, color: "white" },
      ],
      spectatorSocketIds: new Set(),
      fen: null,
      timeControlSeconds: wantedTimeControl,
      // A permanent, never-reused id for this specific match — unlike the
      // short roomId code, which gets recycled once a room is cleaned up.
      // Both players save their own copy of a finished game as separate
      // Firestore documents (so each shows up in their own "my games"
      // list), but they share this one matchId, which is what the Neon
      // analysis cache is actually keyed on — otherwise the two players'
      // saves would get two different cache entries for the same game.
      matchId: randomUUID(),
    });
    socket.join(roomId);
    setUserRoom(uid, roomId);
    socket.emit("searching", { roomId });
  });

  socket.on("cancel_search", ({ roomId } = {}) => {
    const room = rooms.get(roomId);
    if (room && room.players.length === 1 && room.players[0].socketId === socket.id) {
      setUserRoom(room.players[0].uid, null);
      rooms.delete(roomId);
      socket.leave(roomId);
    }
  });

  // ---- Private room: host creates a shareable code ----
  socket.on("create_room", ({ username, uid, photoURL, timeControl } = {}) => {
    leaveAnyRoom(socket);

    const roomId = generateRoomCode();
    rooms.set(roomId, {
      isPrivate: true,
      status: "waiting",
      players: [
        { socketId: socket.id, uid: uid || null, username: username || "Guest", photoURL: photoURL || null, color: "white" },
      ],
      spectatorSocketIds: new Set(),
      fen: null,
      timeControlSeconds: normalizeTimeControl(timeControl),
      matchId: randomUUID(), // see quick_match above for why this exists
    });
    socket.join(roomId);
    setUserRoom(uid, roomId);
    socket.emit("room_created", { roomId, color: "white" });
  });

  // ---- Private room: guest joins with a code ----
  socket.on("join_room", ({ roomId, username, uid, photoURL } = {}) => {
    const code = (roomId || "").trim().toUpperCase();
    const room = rooms.get(code);

    if (!room) {
      socket.emit("room_not_found");
      return;
    }
    if (room.players.length >= 2) {
      socket.emit("room_full");
      return;
    }

    leaveAnyRoom(socket);

    const host = room.players[0];
    room.players.push({
      socketId: socket.id,
      uid: uid || null,
      username: username || "Guest",
      photoURL: photoURL || null,
      color: "black",
    });
    room.status = "playing";
    socket.join(code);
    setUserRoom(uid, code);
    setUserRoom(host.uid, code);

    socket.emit("match_found", {
      roomId: code,
      color: "black",
      opponentUsername: host.username,
      opponentPhotoURL: host.photoURL || null,
      timeControl: room.timeControlSeconds,
      matchId: room.matchId,
    });
    io.to(host.socketId).emit("match_found", {
      roomId: code,
      color: "white",
      opponentUsername: username || "Guest",
      opponentPhotoURL: photoURL || null,
      timeControl: room.timeControlSeconds,
      matchId: room.matchId,
    });
  });

  socket.on("leave_room", () => leaveAnyRoom(socket));

  // ---- Spectating: join a room's socket.io channel without becoming a
  // player. Broadcasts (opponent_move, chat, resign, etc.) already reach
  // everyone joined to the room, so a spectator just needs to be in it and
  // get a snapshot of where the game currently stands. Move history from
  // before they tuned in isn't reconstructed — they see the game live from
  // whenever they join, same as walking up to a real table mid-game.
  socket.on("spectate_room", ({ roomId } = {}) => {
    const code = (roomId || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      socket.emit("spectate_room_not_found");
      return;
    }
    socket.join(code);
    room.spectatorSocketIds.add(socket.id);
    socket.data.spectatingRoomId = code;

    socket.emit("spectate_joined", {
      roomId: code,
      fen: room.fen,
      players: room.players.map((p) => ({ username: p.username, photoURL: p.photoURL, color: p.color })),
    });
  });

  socket.on("leave_spectate", () => {
    const roomId = socket.data.spectatingRoomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (room) room.spectatorSocketIds.delete(socket.id);
    socket.leave(roomId);
    socket.data.spectatingRoomId = null;
  });

  // ---- In-game chat, scoped to a room. Only the two players in the game
  // may send — spectators can watch the chat but not post to it. Resolved
  // purely from the room's own player list (so a player can't spoof a
  // different name, and a spectator can't spoof being a player) rather
  // than trusting anything the client claims about itself.
  socket.on("chat:send", ({ roomId, text } = {}) => {
    const trimmed = (text || "").trim().slice(0, 500);
    if (!trimmed || !roomId) return;
    const room = rooms.get(roomId);
    const sender = room?.players.find((p) => p.socketId === socket.id);
    if (!sender) return; // not a player in this room — likely a spectator, so drop it
    io.to(roomId).emit("chat:message", {
      from: sender.username,
      text: trimmed,
      ts: Date.now(),
    });
  });

  // ---- Challenge a friend directly to a game. Reuses the same room
  // structure as create_room/join_room — the challenger's room is created
  // right away (in a special "challenged" wait state) so accepting is just
  // the normal join_room flow, aimed at a specific pre-made room instead of
  // a shared code someone has to type in.
  socket.on("challenge_friend", ({ toUid, username, uid, photoURL, timeControl } = {}) => {
    if (!toUid || !uid) return;
    leaveAnyRoom(socket);

    const roomId = generateRoomCode();
    rooms.set(roomId, {
      isPrivate: true,
      status: "waiting",
      players: [{ socketId: socket.id, uid, username: username || "Guest", photoURL: photoURL || null, color: "white" }],
      spectatorSocketIds: new Set(),
      fen: null,
      timeControlSeconds: normalizeTimeControl(timeControl),
      matchId: randomUUID(), // see quick_match above for why this exists
    });
    socket.join(roomId);
    setUserRoom(uid, roomId);

    notifyUser(toUid, "challenge_received", {
      roomId,
      fromUid: uid,
      fromUsername: username || "Guest",
      fromPhotoURL: photoURL || null,
      timeControl: rooms.get(roomId).timeControlSeconds,
    });
    socket.emit("challenge_sent", { roomId, toUid });
  });

  // ---- Friend responds to a challenge: accept joins the pre-made room
  // (same shape as join_room's success path); decline just tells the
  // challenger so their client can stop waiting.
  socket.on("challenge_response", ({ roomId, accepted, username, uid, photoURL } = {}) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const host = room.players[0];

    if (!accepted) {
      io.to(host.socketId).emit("challenge_declined", { roomId });
      // The challenger's room only ever had them in it (waiting for a
      // response) — with no one accepting, tear it down and clear their
      // presence, or they'd be stuck looking "in a game" to every other
      // friend indefinitely.
      rooms.delete(roomId);
      if (host.uid) setUserRoom(host.uid, null);
      return;
    }
    if (room.players.length >= 2) return;

    leaveAnyRoom(socket);
    room.players.push({ socketId: socket.id, uid: uid || null, username: username || "Guest", photoURL: photoURL || null, color: "black" });
    room.status = "playing";
    socket.join(roomId);
    setUserRoom(uid, roomId);
    setUserRoom(host.uid, roomId);

    socket.emit("match_found", {
      roomId,
      color: "black",
      opponentUsername: host.username,
      opponentPhotoURL: host.photoURL || null,
      timeControl: room.timeControlSeconds,
      matchId: room.matchId,
    });
    io.to(host.socketId).emit("match_found", {
      roomId,
      color: "white",
      opponentUsername: username || "Guest",
      opponentPhotoURL: photoURL || null,
      timeControl: room.timeControlSeconds,
      matchId: room.matchId,
    });
  });

  socket.on("make_move", ({ roomId, move, fen }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    room.fen = fen;
    // Broadcast the move to the OTHER player in the room
    socket.to(roomId).emit("opponent_move", { move, fen });
  });

  socket.on("resign", ({ roomId } = {}) => {
    const room = rooms.get(roomId);
    if (room) {
      room.status = "finished";
      clearRoomPresence(room);
    }
    // Tell everyone else in the room (opponent + spectators) who the
    // resignation makes the winner, so a spectator can show the same
    // result banner a player would see instead of a bare status line.
    const resigningPlayer = room?.players.find((p) => p.socketId === socket.id);
    const winner = resigningPlayer ? (resigningPlayer.color === "white" ? "black" : "white") : null;
    socket.to(roomId).emit("opponent_resigned", { winner });
  });

  socket.on("offer_draw", ({ roomId } = {}) => {
    socket.to(roomId).emit("draw_offered");
  });

  socket.on("draw_response", ({ roomId, accepted } = {}) => {
    if (accepted) {
      const room = rooms.get(roomId);
      if (room) {
        room.status = "finished";
        clearRoomPresence(room);
      }
    }
    socket.to(roomId).emit("draw_response", { accepted });
  });

  // Client tells us the game reached a normal conclusion (checkmate, draw,
  // resignation, timeout) — this stops a later "leave" from being counted
  // as an abandon-loss on top of the real result. It also carries the
  // reason/winner a player's client already determined (checkmate,
  // stalemate, flag-fall, etc.) so it can be relayed to spectators, who
  // have no chess engine of their own to work that out independently.
  socket.on("game_over", ({ roomId, reason, winner } = {}) => {
    const room = rooms.get(roomId);
    if (room) {
      room.status = "finished";
      clearRoomPresence(room); // belt-and-suspenders: covers any end path that reaches here first
    }
    if (reason) {
      io.to(roomId).emit("game_result", { reason, winner: winner || null });
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    if (socket.data.presenceUid) markOffline(socket.data.presenceUid, socket.id);
    if (socket.data.spectatingRoomId) {
      const room = rooms.get(socket.data.spectatingRoomId);
      if (room) room.spectatorSocketIds.delete(socket.id);
    }
    leaveAnyRoom(socket);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Chess backend running on http://localhost:${PORT}`);
  console.log("Build marker: photoURL-relay + analysis-cache + retry (2026-07)");
  console.log(
    isDbConfigured()
      ? "Neon/Postgres analytics: connected"
      : "Neon/Postgres analytics: not configured (DATABASE_URL unset) — Game Review will re-analyze every time instead of caching, and profile analytics will be empty."
  );
});
