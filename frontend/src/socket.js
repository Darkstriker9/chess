import { io } from "socket.io-client";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";

// One shared socket instance for the whole app.
export const socket = io(BACKEND_URL, { autoConnect: false });
