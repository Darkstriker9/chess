import { useEffect, useRef, useState } from "react";
import { socket } from "./socket.js";

export default function Chat({ roomId, canSend = true }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const listRef = useRef(null);

  useEffect(() => {
    function onMessage(msg) {
      setMessages((m) => [...m, msg]);
      setOpen((isOpen) => {
        if (!isOpen) setUnread((u) => u + 1);
        return isOpen;
      });
    }
    socket.on("chat:message", onMessage);
    return () => socket.off("chat:message", onMessage);
  }, [roomId]);

  useEffect(() => {
    if (open && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, open]);

  function send(e) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || !roomId) return;
    socket.emit("chat:send", { roomId, text: trimmed });
    setText("");
  }

  return (
    <div className={`chat-panel ${open ? "chat-panel--open" : ""}`}>
      <button
        className="chat-toggle"
        onClick={() => {
          setOpen((o) => !o);
          setUnread(0);
        }}
      >
        💬 Chat {unread > 0 && !open && <span className="notif-badge">{unread}</span>}
      </button>

      {open && (
        <div className="chat-body">
          <div className="chat-messages" ref={listRef}>
            {messages.length === 0 && <p className="chat-empty">No messages yet.</p>}
            {messages.map((m, i) => (
              <div key={i} className="chat-message">
                <strong>{m.from}:</strong> {m.text}
              </div>
            ))}
          </div>
          {canSend ? (
            <form className="chat-input-row" onSubmit={send}>
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Say something..."
                maxLength={500}
              />
              <button type="submit" className="control-btn">
                Send
              </button>
            </form>
          ) : (
            <p className="chat-spectator-note">Spectators can watch chat but can't send messages.</p>
          )}
        </div>
      )}
    </div>
  );
}
