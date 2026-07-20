function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function Clock({ label, seconds, isActive, flagged }) {
  return (
    <div className={["clock", isActive ? "active" : "", flagged ? "flagged" : ""].join(" ")}>
      <span className="clock-label">{label}</span>
      <span className="clock-time">{flagged ? "0:00" : formatTime(seconds)}</span>
    </div>
  );
}
