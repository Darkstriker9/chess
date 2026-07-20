import { useEffect, useMemo, useState } from "react";
import { analyzePositions, fetchCachedAnalysis, saveFullAnalysis, saveAnalysisSummary } from "./api.js";
import { UNICODE_PIECES } from "./pieces/index.js";
import Avatar from "./Avatar.jsx";

// A chess.com-style move classification. "Brilliant", "Great", and "Miss"
// are approximated with heuristics (real detection needs multi-line engine
// analysis we don't have access to here) — see classify() below for exactly
// what each one is standing in for. Categories flagged `primary: true` are
// always shown in the summary; the rest live behind the "Show more" toggle,
// same idea as chess.com collapsing Excellent/Good/Book/Inaccuracy by default.
const CATEGORIES = [
  { id: "brilliant", label: "Brilliant", color: "#1baca6", icon: "!!", primary: true },
  { id: "great", label: "Great", color: "#5c8bb0", icon: "!", primary: true },
  { id: "best", label: "Best", color: "#81b64c", icon: "★", primary: true },
  { id: "excellent", label: "Excellent", color: "#6fa84f", icon: "✓", primary: false },
  { id: "good", label: "Good", color: "#8fb4c9", icon: "✓", primary: false },
  { id: "inaccuracy", label: "Inaccuracy", color: "#f0c95c", icon: "?!", primary: false },
  { id: "mistake", label: "Mistake", color: "#f0954c", icon: "?", primary: true },
  { id: "miss", label: "Miss", color: "#e2543c", icon: "✕", primary: true },
  { id: "blunder", label: "Blunder", color: "#b33430", icon: "??", primary: true },
];
const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

const CHUNK_SIZE = 6;

function toScore(result) {
  if (!result || result.error) return null;
  if (result.mate != null) return result.mate > 0 ? 100 : -100;
  return result.eval ?? 0;
}

// `before`/`after` are always from White's point of view (positive = good
// for White), same convention the engine returns. `forMover` flips that to
// "positive = good for whoever just moved," which is what the heuristics
// below actually want to reason about.
function classify({ loss, isBestMove, isCapture, beforeForMover, afterForMover }) {
  if (isBestMove) {
    if (isCapture && afterForMover >= 2.0) return "brilliant";
    if (beforeForMover <= -0.5) return "great";
    return "best";
  }
  if (loss >= 1.5) return beforeForMover >= 1.5 ? "miss" : "blunder";
  if (loss >= 0.7) return "mistake";
  if (loss >= 0.3) return "inaccuracy";
  if (loss >= 0.15) return "good";
  return "excellent";
}

// Widely-used approximation of chess.com's accuracy metric, derived from
// average centipawn loss (ACPL). Not their exact formula (that's private),
// but it tracks the same shape: ~100 at 0 ACPL, dropping off smoothly.
function accuracyFromLosses(losses) {
  if (losses.length === 0) return null;
  const acplCentipawns = (losses.reduce((sum, l) => sum + l, 0) / losses.length) * 100;
  const raw = 103.1668 * Math.exp(-0.04354 * acplCentipawns) - 3.1668;
  return Math.max(0, Math.min(100, raw));
}

function parseFEN(fen) {
  const placement = fen.split(" ")[0];
  return placement.split("/").map((rowStr) => {
    const row = [];
    for (const ch of rowStr) {
      if (/\d/.test(ch)) {
        for (let i = 0; i < Number(ch); i++) row.push(null);
      } else {
        row.push({ type: ch.toLowerCase(), color: ch === ch.toUpperCase() ? "white" : "black" });
      }
    }
    return row;
  });
}

function formatSquarePair(uci) {
  if (!uci || uci.length < 4) return null;
  return { from: uci.slice(0, 2), to: uci.slice(2, 4) };
}

function MiniBoard({ fen, played, suggested }) {
  const board = useMemo(() => parseFEN(fen), [fen]);
  return (
    <div className="review-mini-board">
      {board.map((row, r) =>
        row.map((cell, c) => {
          const square = `${String.fromCharCode(97 + c)}${8 - r}`;
          const isLight = (r + c) % 2 === 0;
          const isPlayed = played && (square === played.from || square === played.to);
          const isSuggested = suggested && (square === suggested.from || square === suggested.to);
          return (
            <div
              key={square}
              className={[
                "review-mini-square",
                isLight ? "light" : "dark",
                isPlayed ? "played" : "",
                isSuggested ? "suggested" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {cell && <span className={`piece ${cell.color}`}>{UNICODE_PIECES[cell.color][cell.type]}</span>}
            </div>
          );
        })
      )}
    </div>
  );
}

export default function GameReview({
  gameId,
  reviewerColor,
  fenHistory,
  sanMoves,
  uciMoves,
  whitePlayer,
  blackPlayer,
  pieceTheme = "classic",
  onClose,
}) {
  const [progress, setProgress] = useState(0);
  const [total] = useState(fenHistory.length);
  const [moveResults, setMoveResults] = useState(null); // [{ san, color, category, loss }]
  const [error, setError] = useState("");
  const [cancelled, setCancelled] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [showMore, setShowMore] = useState(false);
  const [fromCache, setFromCache] = useState(false);

  function classifyAll(results) {
    return sanMoves.map((san, i) => {
      const before = toScore(results[i]);
      const after = toScore(results[i + 1]);
      const moverColor = i % 2 === 0 ? "white" : "black";
      if (before == null || after == null) {
        return { san, color: moverColor, category: null, loss: null };
      }
      const rawLoss = moverColor === "white" ? before - after : after - before;
      const loss = Math.max(0, rawLoss);
      const isBestMove = results[i]?.bestMove === uciMoves[i];
      const beforeForMover = moverColor === "white" ? before : -before;
      const afterForMover = moverColor === "white" ? after : -after;
      const category = classify({
        loss,
        isBestMove,
        isCapture: san.includes("x"),
        beforeForMover,
        afterForMover,
      });
      return { san, color: moverColor, category, loss, bestMove: results[i]?.bestMove || null };
    });
  }

  useEffect(() => {
    let stop = false;
    setCancelled(false);

    (async () => {
      // A game already reviewed once has its analysis cached (Neon/
      // Postgres, keyed by gameId) — skip straight to classification
      // instead of burning through the free engine API's rate limit
      // re-analyzing every position again.
      const cached = await fetchCachedAnalysis(gameId);
      if (stop) return;
      if (cached) {
        setFromCache(true);
        setProgress(fenHistory.length);
        setMoveResults(classifyAll(cached));
        return;
      }

      const results = [];
      for (let i = 0; i < fenHistory.length; i += CHUNK_SIZE) {
        if (stop) return;
        const chunk = fenHistory.slice(i, i + CHUNK_SIZE);
        try {
          const data = await analyzePositions(chunk);
          if (data.error) {
            setError(data.error);
            return;
          }
          results.push(...data.results);
          setProgress(results.length);
        } catch {
          setError("Could not reach the server.");
          return;
        }
      }
      if (stop) return;

      setMoveResults(classifyAll(results));
      saveFullAnalysis(gameId, results); // best-effort; caches for next time
    })();

    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persists this account's accuracy + move-quality counts for the profile
  // page's analytics once — guarded by `saved` so re-renders (e.g. moving
  // the move stepper) don't fire it repeatedly. Skipped entirely for local
  // pass-and-play games (reviewerColor is null there — see Board.jsx).
  useEffect(() => {
    if (!moveResults || !gameId || !reviewerColor) return;

    const losses = moveResults.filter((m) => m.color === reviewerColor && m.loss != null).map((m) => m.loss);
    const accuracy = accuracyFromLosses(losses);
    const counts = {};
    for (const m of moveResults) {
      if (m.color === reviewerColor && m.category) counts[m.category] = (counts[m.category] || 0) + 1;
    }
    saveAnalysisSummary(gameId, { color: reviewerColor, accuracy, counts });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveResults]);

  useEffect(() => {
    if (moveResults && selectedIndex == null && moveResults.length > 0) {
      setSelectedIndex(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveResults]);

  function cancel() {
    setCancelled(true);
    onClose();
  }

  function goPrevMove() {
    setSelectedIndex((i) => Math.max(0, (i ?? 0) - 1));
  }

  function goNextMove() {
    if (!moveResults) return;
    setSelectedIndex((i) => Math.min(moveResults.length - 1, (i ?? -1) + 1));
  }

  const counts = { white: {}, black: {} };
  const accuracy = { white: null, black: null };
  if (moveResults) {
    for (const cat of CATEGORIES) {
      counts.white[cat.id] = 0;
      counts.black[cat.id] = 0;
    }
    for (const m of moveResults) {
      if (m.category) counts[m.color][m.category]++;
    }
    accuracy.white = accuracyFromLosses(
      moveResults.filter((m) => m.color === "white" && m.loss != null).map((m) => m.loss)
    );
    accuracy.black = accuracyFromLosses(
      moveResults.filter((m) => m.color === "black" && m.loss != null).map((m) => m.loss)
    );
  }

  const selected = selectedIndex != null && moveResults ? moveResults[selectedIndex] : null;
  const selectedCat = selected?.category ? CATEGORY_BY_ID[selected.category] : null;
  const selectedFen = selectedIndex != null ? fenHistory[selectedIndex + 1] : null;
  const selectedPlayed = selectedIndex != null ? formatSquarePair(uciMoves[selectedIndex]) : null;
  const showSuggestion =
    selected && selected.bestMove && !["best", "brilliant", "great"].includes(selected.category);
  const selectedSuggested = showSuggestion ? formatSquarePair(selected.bestMove) : null;

  const primaryCategories = CATEGORIES.filter((c) => c.primary);
  const secondaryCategories = CATEGORIES.filter((c) => !c.primary);

  return (
    <div className="promotion-overlay">
      <div className={`review-panel theme-${pieceTheme}`}>
        <button className="back-btn" onClick={cancel}>
          ← Close
        </button>
        <h2 className="review-title">Game Review</h2>

        {!moveResults && !error && (
          <div className="review-progress">
            <p>
              {fromCache
                ? "Loading your previous analysis…"
                : `Analyzing position ${progress} of ${total}…`}
            </p>
            <div className="review-progress-bar">
              <div className="review-progress-fill" style={{ width: `${(progress / total) * 100}%` }} />
            </div>
            <p className="review-note">
              {fromCache
                ? "This game's already been analyzed once — reusing that instead of re-running the engine."
                : "This runs the same free engine used for the AI opponent, one position at a time — long games can take a little while."}
            </p>
          </div>
        )}

        {error && <p className="auth-error">{error}</p>}

        {moveResults && !cancelled && (
          <>
            <div className="review-players">
              <div className="review-player-card">
                <Avatar username={whitePlayer?.name} photoURL={whitePlayer?.photoURL} size={40} />
                <span className="review-player-name">{whitePlayer?.name || "White"}</span>
                {accuracy.white != null && (
                  <span className="review-accuracy-badge review-accuracy-badge--white">
                    {accuracy.white.toFixed(1)}%
                  </span>
                )}
              </div>
              <span className="review-players-vs">Accuracy</span>
              <div className="review-player-card">
                <Avatar username={blackPlayer?.name} photoURL={blackPlayer?.photoURL} size={40} />
                <span className="review-player-name">{blackPlayer?.name || "Black"}</span>
                {accuracy.black != null && (
                  <span className="review-accuracy-badge review-accuracy-badge--black">
                    {accuracy.black.toFixed(1)}%
                  </span>
                )}
              </div>
            </div>

            <div className="review-category-table">
              {primaryCategories.map((cat) => (
                <div key={cat.id} className="review-category-row">
                  <span className="review-category-count">{counts.white[cat.id]}</span>
                  <span className="review-category-mid">
                    <span className="review-category-icon" style={{ background: cat.color }}>
                      {cat.icon}
                    </span>
                    <span className="review-category-label">{cat.label}</span>
                  </span>
                  <span className="review-category-count">{counts.black[cat.id]}</span>
                </div>
              ))}

              {showMore &&
                secondaryCategories.map((cat) => (
                  <div key={cat.id} className="review-category-row">
                    <span className="review-category-count">{counts.white[cat.id]}</span>
                    <span className="review-category-mid">
                      <span className="review-category-icon" style={{ background: cat.color }}>
                        {cat.icon}
                      </span>
                      <span className="review-category-label">{cat.label}</span>
                    </span>
                    <span className="review-category-count">{counts.black[cat.id]}</span>
                  </div>
                ))}

              <button className="review-more-toggle" onClick={() => setShowMore((s) => !s)}>
                {showMore ? "▲ Show less" : "▼ Show more"}
              </button>
            </div>

            {selected && selectedFen && (
              <div className="review-move-detail">
                <MiniBoard fen={selectedFen} played={selectedPlayed} suggested={selectedSuggested} />
                <div className="review-move-detail-text">
                  <p>
                    <span className="review-move-num">
                      {Math.floor(selectedIndex / 2) + 1}
                      {selected.color === "white" ? "." : "..."}
                    </span>
                    <span className="review-move-detail-san">{selected.san}</span>
                    {selectedCat && (
                      <span className="review-move-tag" style={{ color: selectedCat.color }}>
                        {selectedCat.icon} {selectedCat.label}
                      </span>
                    )}
                  </p>
                  {selectedSuggested && (
                    <p className="review-note">
                      Engine preferred {selectedSuggested.from} → {selectedSuggested.to}
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="review-stepper">
              <button className="control-btn" onClick={goPrevMove} disabled={!selectedIndex}>
                ← Previous
              </button>
              <span className="review-stepper-count">
                Move {selectedIndex + 1} of {moveResults.length}
              </span>
              <button
                className="control-btn"
                onClick={goNextMove}
                disabled={selectedIndex >= moveResults.length - 1}
              >
                Next →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
