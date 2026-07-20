// Tracks which logged-in accounts currently have an active Socket.io
// connection (for the friends list online dot), which room they're
// currently playing in (so friends can spectate), and provides a bridge
// so plain REST routes (friends.js) can push real-time socket events —
// e.g. notifying someone the instant a friend request arrives, without
// friends.js needing to import socket.io directly.
// In-memory only — like the room state in server.js, this resets if the
// backend restarts, and only knows about one server process.

const onlineUids = new Map(); // uid -> Set<socketId> (multiple tabs/devices)
const uidToRoom = new Map(); // uid -> roomId (only while actively playing)
let ioRef = null;

export function setIO(io) {
  ioRef = io;
}

export function markOnline(uid, socketId) {
  if (!uid) return;
  if (!onlineUids.has(uid)) onlineUids.set(uid, new Set());
  onlineUids.get(uid).add(socketId);
}

export function markOffline(uid, socketId) {
  const set = onlineUids.get(uid);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) {
    onlineUids.delete(uid);
    uidToRoom.delete(uid);
  }
}

export function isOnline(uid) {
  return onlineUids.has(uid);
}

export function setUserRoom(uid, roomId) {
  if (!uid) return;
  if (roomId) uidToRoom.set(uid, roomId);
  else uidToRoom.delete(uid);
}

export function getUserRoom(uid) {
  return uidToRoom.get(uid) || null;
}

// Sends a socket event to every connection a user currently has open (they
// may have multiple tabs). No-op if they're offline or io isn't wired up
// yet — callers should treat this as best-effort, not guaranteed delivery.
export function notifyUser(uid, event, payload) {
  if (!ioRef || !uid) return;
  const socketIds = onlineUids.get(uid);
  if (!socketIds) return;
  for (const socketId of socketIds) {
    ioRef.to(socketId).emit(event, payload);
  }
}
