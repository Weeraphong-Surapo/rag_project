import { config } from "./config.js";

async function post(path, body, signal) {
  const res = await fetch(`${config.ollamaUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    throw new Error(`Ollama ${path} failed (${res.status}): ${await res.text()}`);
  }
  return res;
}

/** Embed one or many texts with bge-m3. Returns number[][] */
export async function embed(input) {
  const res = await post("/api/embed", {
    model: config.embedModel,
    input,
  });
  const data = await res.json();
  return data.embeddings;
}

/** Non-streaming chat. Returns the assistant message text. */
export async function chat(messages, options = {}) {
  const res = await post("/api/chat", {
    model: config.llmModel,
    messages,
    stream: false,
    options: { temperature: 0.2, ...options },
  });
  const data = await res.json();
  return data.message?.content ?? "";
}

/** Streaming chat. Yields text tokens. */
export async function* chatStream(messages, options = {}, signal) {
  const res = await post(
    "/api/chat",
    {
      model: config.llmModel,
      messages,
      stream: true,
      options: { temperature: 0.2, ...options },
    },
    signal
  );
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      const json = JSON.parse(line);
      if (json.message?.content) yield json.message.content;
    }
  }
}
