import { useEffect, useState } from "react";
import { fetchFriends, respondToFriendRequest } from "./api.js";
import { socket } from "./socket.js";
import Avatar from "./Avatar.jsx";

// Shows pending friend requests (fetched once, then kept live via socket
// push from the backend) and incoming game challenges (socket-only — these
// aren't persisted anywhere, so a page reload loses any that arrived while
// you were away, same as a missed phone call).
export default function NotificationBell({ user, onAcceptChallenge, onDeclineChallenge }) {
  const [open, setOpen] = useState(false);
  const [requests, setRequests] = useState([]);
  const [challenges, setChallenges] = useState([]);
  const [busyUid, setBusyUid] = useState(null);

  useEffect(() => {
    if (!user) return;
    refreshRequests();

    function onRequestReceived() {
      refreshRequests();
    }
    function onRequestAccepted() {
      refreshRequests();
    }
    function onChallengeReceived(challenge) {
      setChallenges((c) => [...c, challenge]);
    }
    function onChallengeDeclined({ roomId }) {
      setChallenges((c) => c.filter((ch) => ch.roomId !== roomId));
    }

    socket.on("friend_request_received", onRequestReceived);
    socket.on("friend_request_accepted", onRequestAccepted);
    socket.on("challenge_received", onChallengeReceived);
    socket.on("challenge_declined", onChallengeDeclined);
    return () => {
      socket.off("friend_request_received", onRequestReceived);
      socket.off("friend_request_accepted", onRequestAccepted);
      socket.off("challenge_received", onChallengeReceived);
      socket.off("challenge_declined", onChallengeDeclined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  async function refreshRequests() {
    const data = await fetchFriends();
    if (!data.error) setRequests(data.incoming || []);
  }

  async function respond(requesterUid, accept) {
    setBusyUid(requesterUid);
    try {
      await respondToFriendRequest(requesterUid, accept);
      setRequests((r) => r.filter((f) => f.uid !== requesterUid));
    } finally {
      setBusyUid(null);
    }
  }

  function acceptChallenge(challenge) {
    onAcceptChallenge(challenge);
    setChallenges((c) => c.filter((ch) => ch.roomId !== challenge.roomId));
  }

  function declineChallenge(challenge) {
    onDeclineChallenge(challenge);
    setChallenges((c) => c.filter((ch) => ch.roomId !== challenge.roomId));
  }

  const count = requests.length + challenges.length;

  return (
    <div className="notif-bell">
      <button className="notif-bell-trigger" onClick={() => setOpen((o) => !o)} aria-label="Notifications">
        🔔
        {count > 0 && <span className="notif-badge">{count}</span>}
      </button>

      {open && (
        <div className="notif-dropdown">
          {count === 0 && <p className="notif-empty">Nothing new.</p>}

          {challenges.map((ch) => (
            <div key={ch.roomId} className="notif-item">
              <Avatar username={ch.fromUsername} photoURL={ch.fromPhotoURL} size={26} />
              <span className="notif-item-text">
                <strong>{ch.fromUsername}</strong> challenged you to a{" "}
                {ch.timeControl ? `${Math.round(ch.timeControl / 60)} min` : ""} game
              </span>
              <div className="notif-item-actions">
                <button className="control-btn" onClick={() => acceptChallenge(ch)}>
                  Accept
                </button>
                <button className="link-btn" onClick={() => declineChallenge(ch)}>
                  Decline
                </button>
              </div>
            </div>
          ))}

          {requests.map((r) => (
            <div key={r.uid} className="notif-item">
              <Avatar username={r.username} photoURL={r.photoURL} size={26} />
              <span className="notif-item-text">
                <strong>{r.username}</strong> sent you a friend request
              </span>
              <div className="notif-item-actions">
                <button className="control-btn" disabled={busyUid === r.uid} onClick={() => respond(r.uid, true)}>
                  Accept
                </button>
                <button className="link-btn" disabled={busyUid === r.uid} onClick={() => respond(r.uid, false)}>
                  Decline
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
