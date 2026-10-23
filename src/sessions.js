import { randomUUID } from "node:crypto";

const MAX_MESSAGES = 12; // last 6 turns (user + assistant)
const TTL_MS = 60 * 60 * 1000; // 1 hour idle

/** In-memory chat sessions: id -> { messages, touched } */
const sessions = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) if (now - s.touched > TTL_MS) sessions.delete(id);
}, 5 * 60 * 1000).unref();

export function resolveId(id) {
  return typeof id === "string" && id.length > 0 && id.length <= 100 ? id : randomUUID();
}

export function getHistory(id) {
  const s = sessions.get(id);
  return s ? [...s.messages] : [];
}

export function addTurn(id, question, answer) {
  const s = sessions.get(id) ?? { messages: [], touched: 0 };
  s.messages.push({ role: "user", content: question }, { role: "assistant", content: answer });
  s.messages = s.messages.slice(-MAX_MESSAGES);
  s.touched = Date.now();
  sessions.set(id, s);
}

export function clearSession(id) {
  return sessions.delete(id);
}
