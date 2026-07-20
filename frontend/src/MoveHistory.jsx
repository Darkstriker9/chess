export default function MoveHistory({ moves }) {
  // moves: array of SAN strings in order. Group into [white, black] pairs.
  const pairs = [];
  for (let i = 0; i < moves.length; i += 2) {
    pairs.push({ num: i / 2 + 1, white: moves[i], black: moves[i + 1] });
  }

  return (
    <div className="move-history">
      <h3>Moves</h3>
      <div className="move-list">
        {pairs.map((p) => (
          <div key={p.num} className="move-row">
            <span className="move-num">{p.num}.</span>
            <span className="move-white">{p.white}</span>
            <span className="move-black">{p.black || ""}</span>
          </div>
        ))}
        {pairs.length === 0 && <p className="move-empty">No moves yet.</p>}
      </div>
    </div>
  );
}
