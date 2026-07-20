import Avatar from "./Avatar.jsx";
import { UNICODE_PIECES } from "./pieces/index.js";

const PIECE_ORDER = ["q", "r", "b", "n", "p"]; // display heaviest captures first

export default function PlayerBar({ name, photoURL, captured = [], materialLead = 0, isActive }) {
  const sorted = [...captured].sort((a, b) => PIECE_ORDER.indexOf(a.type) - PIECE_ORDER.indexOf(b.type));

  return (
    <div className={`player-bar ${isActive ? "player-bar--active" : ""}`}>
      <Avatar username={name} photoURL={photoURL} size={36} />
      <div className="player-bar-info">
        <span className="player-bar-name">{name}</span>
        {sorted.length > 0 && (
          <div className="player-bar-captures">
            {sorted.map((p, i) => (
              <span key={i} className="captured-piece">
                {UNICODE_PIECES[p.color][p.type]}
              </span>
            ))}
            {materialLead > 0 && <span className="material-lead">+{materialLead}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
