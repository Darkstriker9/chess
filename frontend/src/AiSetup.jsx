import { useState } from "react";

// chess-api.com (free tier) caps search depth at 18 — these six levels
// spread across that range. There's no true Elo-limiting on the free
// engine, so treat these as "how deep it searches," not a precise rating.
export const AI_DIFFICULTIES = [
  { id: "rookie", label: "Rookie", depth: 3, blurb: "Blunders often — good for learning the rules" },
  { id: "amateur", label: "Amateur", depth: 6, blurb: "Casual club-level play" },
  { id: "pro", label: "Pro", depth: 9, blurb: "Solid tactics, punishes mistakes" },
  { id: "master", label: "Master", depth: 12, blurb: "Strong positional play" },
  { id: "superstar", label: "Superstar", depth: 15, blurb: "Very few weaknesses" },
  { id: "grandmaster", label: "Grandmaster", depth: 18, blurb: "Maximum engine strength" },
];

export default function AiSetup({ onStart, onBack }) {
  const [difficulty, setDifficulty] = useState("amateur");
  const [color, setColor] = useState("white");

  function start() {
    const chosen = AI_DIFFICULTIES.find((d) => d.id === difficulty);
    const finalColor = color === "random" ? (Math.random() < 0.5 ? "white" : "black") : color;
    onStart({ depth: chosen.depth, difficultyLabel: chosen.label, userColor: finalColor });
  }

  return (
    <div className="ai-setup">
      <button className="back-btn" onClick={onBack}>
        ← Back to menu
      </button>
      <h1 className="ai-setup-title">Vs AI</h1>

      <div className="ai-setup-section">
        <h2>Difficulty</h2>
        <div className="difficulty-grid">
          {AI_DIFFICULTIES.map((d) => (
            <button
              key={d.id}
              className={`difficulty-card ${difficulty === d.id ? "selected" : ""}`}
              onClick={() => setDifficulty(d.id)}
            >
              <span className="difficulty-label">{d.label}</span>
              <span className="difficulty-blurb">{d.blurb}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="ai-setup-section">
        <h2>Play as</h2>
        <div className="color-grid">
          <button className={`color-card ${color === "white" ? "selected" : ""}`} onClick={() => setColor("white")}>
            <span className="color-swatch color-swatch--white" /> White
          </button>
          <button className={`color-card ${color === "black" ? "selected" : ""}`} onClick={() => setColor("black")}>
            <span className="color-swatch color-swatch--black" /> Black
          </button>
          <button className={`color-card ${color === "random" ? "selected" : ""}`} onClick={() => setColor("random")}>
            <span className="color-swatch color-swatch--random" /> Random
          </button>
        </div>
      </div>

      <button className="ai-setup-start" onClick={start}>
        Start game
      </button>
    </div>
  );
}
