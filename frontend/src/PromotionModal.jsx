import { UNICODE_PIECES } from "./pieces/index.js";

const CHOICES = ["q", "r", "b", "n"];

export default function PromotionModal({ color, onChoose }) {
  return (
    <div className="promotion-overlay">
      <div className="promotion-box">
        <p>Promote pawn to:</p>
        <div className="promotion-choices">
          {CHOICES.map((type) => (
            <button key={type} onClick={() => onChoose(type)}>
              {UNICODE_PIECES[color][type]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
