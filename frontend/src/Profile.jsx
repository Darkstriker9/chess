import { useEffect, useState } from "react";
import { updateProfile } from "firebase/auth";
import { auth } from "./firebase.js";
import { socket } from "./socket.js";
import {
  fetchProfile,
  fetchMyGames,
  fetchMoveAnalytics,
  fetchFriends,
  searchUsers,
  sendFriendRequest,
  respondToFriendRequest,
  fetchFriendStats,
  removeFriend,
  deleteAccount,
} from "./api.js";
import Avatar from "./Avatar.jsx";

function resultLabel(result) {
  if (result === "1-0") return "1 – 0";
  if (result === "0-1") return "0 – 1";
  if (result === "1/2-1/2") return "½ – ½";
  return result || "—";
}

// Same chess.com-style presets as the online lobby, so a friend challenge
// starts at whatever time control the challenger actually picks instead of
// always defaulting to 10 minutes.
const TIME_CONTROLS = [
  { seconds: 60, label: "1 min", sub: "Bullet" },
  { seconds: 180, label: "3 min", sub: "Blitz" },
  { seconds: 600, label: "10 min", sub: "Rapid" },
];

export default function Profile({ onBack, onAccountDeleted, onProfileUpdated, onSpectate }) {
  const [tab, setTab] = useState("stats"); // 'stats' | 'friends'
  const [stats, setStats] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [challengingUid, setChallengingUid] = useState(null);
  const [challengeError, setChallengeError] = useState("");
  const [challengeTimeControl, setChallengeTimeControl] = useState(600); // seconds per side

  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const [avatarUrlInput, setAvatarUrlInput] = useState("");
  const [editingAvatarUrl, setEditingAvatarUrl] = useState(false);
  // Firebase Auth's `photoURL` is never synced to the backend/Firestore, so
  // reading it from the fetched `stats` object (like the rest of the
  // profile) would go stale on every reload — track it straight from the
  // live Auth SDK instead, which is always accurate for the signed-in user.
  const [photoURL, setPhotoURL] = useState(auth.currentUser?.photoURL || null);

  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const [friends, setFriends] = useState({ friends: [], incoming: [], outgoing: [] });
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const [selectedFriend, setSelectedFriend] = useState(null); // { uid, username }
  const [friendStats, setFriendStats] = useState(null);
  const [friendStatsLoading, setFriendStatsLoading] = useState(false);
  const [unfriending, setUnfriending] = useState(false);

  function loadFriends() {
    fetchFriends().then((data) => {
      if (!data.error) setFriends(data);
    });
  }

  useEffect(() => {
    function onDeclined() {
      setChallengingUid(null);
      setChallengeError("They declined the challenge.");
    }
    socket.on("challenge_declined", onDeclined);
    return () => socket.off("challenge_declined", onDeclined);
  }, []);

  function challengeFriend(f) {
    if (!auth.currentUser) return;
    setChallengeError("");
    setChallengingUid(f.uid);
    socket.emit("challenge_friend", {
      toUid: f.uid,
      uid: auth.currentUser.uid,
      username: auth.currentUser.displayName,
      photoURL,
      timeControl: challengeTimeControl,
    });
    // App.jsx's global "match_found" listener handles navigating once they
    // accept — this component doesn't need to wait for it directly.
  }

  // Keep online/offline dots reasonably fresh while looking at the tab.
  useEffect(() => {
    if (tab !== "friends") return;
    const interval = setInterval(loadFriends, 12000);
    return () => clearInterval(interval);
  }, [tab]);

  const [friendStatsError, setFriendStatsError] = useState("");

  async function openFriend(f) {
    setSelectedFriend(f);
    setFriendStats(null);
    setFriendStatsError("");
    setFriendStatsLoading(true);
    try {
      const data = await fetchFriendStats(f.uid);
      if (data.error) {
        setFriendStatsError(data.error);
      } else {
        setFriendStats(data);
      }
    } catch {
      setFriendStatsError("Could not reach the server.");
    } finally {
      setFriendStatsLoading(false);
    }
  }

  async function handleUnfriend(uid) {
    if (!window.confirm("Remove this friend?")) return;
    setUnfriending(true);
    try {
      await removeFriend(uid);
    } catch {
      /* best-effort; loadFriends() below will just show the friend still there */
    } finally {
      setUnfriending(false);
      setSelectedFriend(null);
      loadFriends();
    }
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [profileData, gamesData, analyticsData] = await Promise.all([
          fetchProfile(),
          fetchMyGames(),
          fetchMoveAnalytics().catch(() => null), // analytics is a bonus, not load-bearing
        ]);
        if (cancelled) return;
        if (profileData.error) {
          setError(profileData.error);
        } else {
          setStats(profileData);
          setGames(gamesData.games || []);
          setAnalytics(analyticsData);
        }
      } catch {
        if (!cancelled) setError("Could not reach the server.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    loadFriends();

    return () => {
      cancelled = true;
    };
  }, []);

  function isLikelyImageUrl(url) {
    try {
      const u = new URL(url);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }

  async function handleAvatarUrlSave() {
    const url = avatarUrlInput.trim();
    if (!auth.currentUser) return;

    if (!isLikelyImageUrl(url)) {
      setAvatarError("Please enter a valid image URL (starting with http:// or https://).");
      return;
    }

    setAvatarError("");
    setAvatarSaving(true);
    try {
      await updateProfile(auth.currentUser, { photoURL: url });
      setPhotoURL(url);
      onProfileUpdated?.({ photoURL: url });
      setEditingAvatarUrl(false);
      setAvatarUrlInput("");
    } catch (err) {
      console.error("Avatar URL update failed:", err);
      setAvatarError("Couldn't save that photo URL — please try again.");
    } finally {
      setAvatarSaving(false);
    }
  }

  async function handleAvatarRemove() {
    if (!auth.currentUser) return;
    setAvatarSaving(true);
    setAvatarError("");
    try {
      // Firebase Auth's updateProfile doesn't reliably clear photoURL when
      // passed `null` (it can silently no-op server-side, so the old photo
      // comes back on the next reload even though the UI looked cleared) —
      // an empty string is what it actually honors for "remove this field."
      await updateProfile(auth.currentUser, { photoURL: "" });
      setPhotoURL(null);
      onProfileUpdated?.({ photoURL: null });
    } catch (err) {
      console.error("Avatar removal failed:", err);
      setAvatarError("Couldn't remove the photo — please try again.");
    } finally {
      setAvatarSaving(false);
    }
  }

  async function handleDeleteAccount() {
    if (!window.confirm("Delete your account? This removes your profile, stats, and friends list permanently.")) {
      return;
    }
    if (!window.confirm("This cannot be undone. Delete your account for good?")) {
      return;
    }
    setDeleting(true);
    setDeleteError("");
    try {
      const result = await deleteAccount();
      if (result.error) {
        setDeleteError(result.error);
        setDeleting(false);
        return;
      }
      onAccountDeleted?.();
    } catch {
      setDeleteError("Could not reach the server.");
      setDeleting(false);
    }
  }

  async function runSearch(q) {
    setQuery(q);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const data = await searchUsers(q.trim());
    setSearching(false);
    if (!data.error) setResults(data.results || []);
  }

  async function addFriend(uid) {
    await sendFriendRequest(uid);
    setResults((rs) => rs.map((r) => (r.uid === uid ? { ...r, status: "pending" } : r)));
  }

  async function respond(uid, accept) {
    await respondToFriendRequest(uid, accept);
    loadFriends();
  }

  return (
    <div className="menu profile">
      <button className="back-btn" onClick={onBack}>
        ← Back to menu
      </button>

      <div className="profile-avatar-block">
        <Avatar username={stats?.username} photoURL={photoURL} size={72} />

        {!editingAvatarUrl ? (
          <div className="profile-avatar-actions">
            <button
              className="link-btn"
              onClick={() => {
                setAvatarUrlInput(photoURL || "");
                setEditingAvatarUrl(true);
                setAvatarError("");
              }}
            >
              {photoURL ? "Change photo" : "Set photo from URL"}
            </button>
            {photoURL && (
              <button className="link-btn" onClick={handleAvatarRemove} disabled={avatarSaving}>
                Remove
              </button>
            )}
          </div>
        ) : (
          <div className="profile-avatar-url-form">
            <input
              type="url"
              placeholder="https://example.com/your-photo.jpg"
              value={avatarUrlInput}
              onChange={(e) => setAvatarUrlInput(e.target.value)}
              autoFocus
            />
            <div className="profile-avatar-actions">
              <button className="control-btn" onClick={handleAvatarUrlSave} disabled={avatarSaving}>
                {avatarSaving ? "Saving..." : "Save"}
              </button>
              <button
                className="link-btn"
                onClick={() => {
                  setEditingAvatarUrl(false);
                  setAvatarError("");
                }}
                disabled={avatarSaving}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {avatarError && <p className="auth-error">{avatarError}</p>}
      </div>

      <h1>Profile</h1>

      {loading && <p>Loading…</p>}
      {error && <p className="auth-error">{error}</p>}

      {stats && (
        <>
          <p className="profile-username">{stats.username}</p>

          <div className="profile-tabs">
            <button className={tab === "stats" ? "selected" : ""} onClick={() => setTab("stats")}>
              Stats
            </button>
            <button className={tab === "friends" ? "selected" : ""} onClick={() => setTab("friends")}>
              Friends {friends.incoming.length > 0 && <span className="tab-badge">{friends.incoming.length}</span>}
            </button>
          </div>

          {tab === "stats" && (
            <>
              <div className="profile-stats">
                <div className="stat">
                  <span className="stat-value">{stats.matchesPlayed}</span>
                  <span className="stat-label">Played</span>
                </div>
                <div className="stat">
                  <span className="stat-value">{stats.wins}</span>
                  <span className="stat-label">Wins</span>
                </div>
                <div className="stat">
                  <span className="stat-value">{stats.draws}</span>
                  <span className="stat-label">Draws</span>
                </div>
                <div className="stat">
                  <span className="stat-value">{stats.losses}</span>
                  <span className="stat-label">Losses</span>
                </div>
              </div>

              {analytics && analytics.gamesAnalyzed > 0 && (
                <div className="analytics-panel">
                  <h3>Move Accuracy</h3>
                  <p className="analytics-sub">
                    From {analytics.gamesAnalyzed} reviewed game{analytics.gamesAnalyzed === 1 ? "" : "s"}
                  </p>

                  <div className="analytics-summary">
                    <div className="analytics-accuracy">
                      <span className="analytics-accuracy-value">
                        {analytics.averageAccuracy != null ? `${analytics.averageAccuracy.toFixed(1)}%` : "—"}
                      </span>
                      <span className="analytics-accuracy-label">Avg. accuracy</span>
                    </div>

                    {analytics.recentAccuracies.length > 1 && (
                      <div className="analytics-trend" title="Accuracy over your most recently reviewed games">
                        {analytics.recentAccuracies.map((v, i) => (
                          <span
                            key={i}
                            className="analytics-trend-bar"
                            style={{ height: `${Math.max(6, v)}%` }}
                            title={`${v.toFixed(1)}%`}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="analytics-totals">
                    <div className="analytics-total">
                      <span className="analytics-total-value">{analytics.totals.blunder || 0}</span>
                      <span className="analytics-total-label">Blunders</span>
                    </div>
                    <div className="analytics-total">
                      <span className="analytics-total-value">{analytics.totals.mistake || 0}</span>
                      <span className="analytics-total-label">Mistakes</span>
                    </div>
                    <div className="analytics-total">
                      <span className="analytics-total-value">{analytics.totals.inaccuracy || 0}</span>
                      <span className="analytics-total-label">Inaccuracies</span>
                    </div>
                    <div className="analytics-total">
                      <span className="analytics-total-value">{analytics.totals.best || 0}</span>
                      <span className="analytics-total-label">Best moves</span>
                    </div>
                  </div>
                </div>
              )}

              {!loading && games.length === 0 && !error && (
                <p className="profile-empty">No saved games yet — finish a game to see it here.</p>
              )}

              {games.length > 0 && (
                <ul className="profile-games">
                  {games.map((g) => (
                    <li key={g.id}>
                      <span className="profile-game-players">
                        {g.white_username || "White"} vs {g.black_username || "Black"}
                      </span>
                      <span className="profile-game-result">{resultLabel(g.result)}</span>
                      <span className="profile-game-date">
                        {g.created_at ? new Date(g.created_at).toLocaleDateString() : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {tab === "friends" && (
            <div className="friends-panel">
              <div className="friends-search">
                <input
                  placeholder="Search by username"
                  value={query}
                  onChange={(e) => runSearch(e.target.value)}
                />
                {searching && <span className="friends-search-status">Searching…</span>}
                {results.length > 0 && (
                  <ul className="friends-results">
                    {results.map((r) => (
                      <li key={r.uid}>
                        <span className="friends-result-name">
                          <Avatar username={r.username} photoURL={r.photoURL} size={22} /> {r.username}
                        </span>
                        {r.status === "friends" && <span className="friends-tag">Friends</span>}
                        {r.status === "pending" && <span className="friends-tag">Requested</span>}
                        {r.status === "none" && (
                          <button className="control-btn" onClick={() => addFriend(r.uid)}>
                            Add
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {friends.incoming.length > 0 && (
                <div className="friends-section">
                  <h3>Requests</h3>
                  <ul className="friends-list">
                    {friends.incoming.map((f) => (
                      <li key={f.uid}>
                        <span className="friends-result-name">
                          <span className={`presence-dot ${f.online ? "presence-dot--online" : ""}`} />
                          <Avatar username={f.username} photoURL={f.photoURL} size={22} /> {f.username}
                        </span>
                        <div className="friends-request-actions">
                          <button className="control-btn" onClick={() => respond(f.uid, true)}>
                            Accept
                          </button>
                          <button className="control-btn" onClick={() => respond(f.uid, false)}>
                            Decline
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="friends-section">
                <h3>Friends ({friends.friends.length})</h3>
                {friends.friends.length > 0 && (
                  <div className="time-control-picker time-control-picker--compact">
                    <span className="time-control-label">Challenge time control</span>
                    <div className="time-control-options">
                      {TIME_CONTROLS.map((tc) => (
                        <button
                          key={tc.seconds}
                          type="button"
                          className={`time-control-btn ${challengeTimeControl === tc.seconds ? "selected" : ""}`}
                          onClick={() => setChallengeTimeControl(tc.seconds)}
                        >
                          <span className="time-control-btn-label">{tc.label}</span>
                          <span className="time-control-btn-sub">{tc.sub}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {challengeError && <p className="auth-error">{challengeError}</p>}
                {friends.friends.length === 0 ? (
                  <p className="profile-empty">No friends yet — search above to add some.</p>
                ) : (
                  <ul className="friends-list">
                    {friends.friends.map((f) => (
                      <li key={f.uid} className="friends-list-clickable">
                        <span className="friends-result-name" onClick={() => openFriend(f)}>
                          <span className={`presence-dot ${f.online ? "presence-dot--online" : ""}`} />
                          <Avatar username={f.username} photoURL={f.photoURL} size={22} /> {f.username}
                        </span>
                        {f.roomId ? (
                          <button
                            className="control-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSpectate?.(f.roomId);
                            }}
                          >
                            👁 Watch
                          </button>
                        ) : f.online ? (
                          <button
                            className="control-btn"
                            disabled={challengingUid === f.uid}
                            onClick={(e) => {
                              e.stopPropagation();
                              challengeFriend(f);
                            }}
                          >
                            {challengingUid === f.uid ? "Waiting..." : "Challenge"}
                          </button>
                        ) : (
                          <span className="friends-tag">Offline</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {friends.outgoing.length > 0 && (
                <div className="friends-section">
                  <h3>Pending</h3>
                  <ul className="friends-list">
                    {friends.outgoing.map((f) => (
                      <li key={f.uid}>
                        <span className="friends-result-name">
                          <Avatar username={f.username} photoURL={f.photoURL} size={22} /> {f.username}
                        </span>
                        <span className="friends-tag">Waiting...</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {selectedFriend && (
        <div className="promotion-overlay" onClick={() => setSelectedFriend(null)}>
          <div className="friend-modal" onClick={(e) => e.stopPropagation()}>
            <button className="back-btn" onClick={() => setSelectedFriend(null)}>
              ← Close
            </button>
            <Avatar username={selectedFriend.username} photoURL={selectedFriend.photoURL} size={56} />
            <p className="profile-username">{selectedFriend.username}</p>
            <span className={`presence-tag ${selectedFriend.online ? "presence-tag--online" : ""}`}>
              {selectedFriend.online ? "Online" : "Offline"}
            </span>

            {friendStatsLoading && <p>Loading…</p>}
            {friendStatsError && <p className="auth-error">{friendStatsError}</p>}

            {friendStats && (
              <div className="profile-stats">
                <div className="stat">
                  <span className="stat-value">{friendStats.matchesPlayed}</span>
                  <span className="stat-label">Played</span>
                </div>
                <div className="stat">
                  <span className="stat-value">{friendStats.wins}</span>
                  <span className="stat-label">Wins</span>
                </div>
                <div className="stat">
                  <span className="stat-value">{friendStats.draws}</span>
                  <span className="stat-label">Draws</span>
                </div>
                <div className="stat">
                  <span className="stat-value">{friendStats.losses}</span>
                  <span className="stat-label">Losses</span>
                </div>
              </div>
            )}

            <button
              className="danger-btn"
              onClick={() => handleUnfriend(selectedFriend.uid)}
              disabled={unfriending}
            >
              {unfriending ? "Removing..." : "Unfriend"}
            </button>
          </div>
        </div>
      )}

      <div className="danger-zone">
        <button className="danger-btn" onClick={handleDeleteAccount} disabled={deleting}>
          {deleting ? "Deleting..." : "Delete account"}
        </button>
        {deleteError && <p className="auth-error">{deleteError}</p>}
      </div>
    </div>
  );
}
