// Deterministic color per username so the same person always gets the
// same fallback circle color, without needing to store anything extra.
const PALETTE = ["#e7b750", "#35c99c", "#e2543c", "#6a8fd8", "#c76bd6", "#4fb3c9"];

function colorFor(username) {
  const str = username || "?";
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

export default function Avatar({ username, photoURL, size = 32 }) {
  const style = { width: size, height: size, fontSize: size * 0.45 };

  if (photoURL) {
    return (
      <img
        className="avatar avatar-img"
        style={style}
        src={photoURL}
        alt={username || "avatar"}
        referrerPolicy="no-referrer"
      />
    );
  }

  const initial = (username || "?").trim().charAt(0).toUpperCase() || "?";

  return (
    <span className="avatar avatar-fallback" style={{ ...style, background: colorFor(username) }}>
      {initial}
    </span>
  );
}
