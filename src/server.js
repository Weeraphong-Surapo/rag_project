import express from "express";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import * as rag from "./rag.js";
import * as store from "./vectorStore.js";
import * as sessions from "./sessions.js";
import { extractFromFile, looksBinary } from "./extract.js";

const app = express();
app.use(express.json({ limit: "5mb" }));

// Static UI (public, no auth needed to load the page; API calls still require the key)
app.use(express.static(fileURLToPath(new URL("../public", import.meta.url))));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Optional API key auth (enabled when API_KEY is set)
app.use((req, res, next) => {
  if (!config.apiKey || req.path === "/health") return next();
  const given = Buffer.from(String(req.get("x-api-key") || ""));
  const expected = Buffer.from(config.apiKey);
  if (given.length === expected.length && timingSafeEqual(given, expected)) return next();
  res.status(401).json({ error: "Unauthorized" });
});

app.get("/health", wrap(async (req, res) => {
  let ollama = "down";
  try {
    const r = await fetch(`${config.ollamaUrl}/api/tags`);
    if (r.ok) ollama = "up";
  } catch {}
  const qdrant = (await store.ping()) ? "up" : "down";
  res.json({
    status: "ok",
    ollama,
    qdrant,
    llmModel: config.llmModel,
    embedModel: config.embedModel,
  });
}));

// Upload a file (PDF / txt / md / csv / json) as a raw body: ?filename=name.pdf
app.post("/documents/upload", express.raw({ type: () => true, limit: "30mb" }), wrap(async (req, res) => {
  const filename = String(req.query.filename || "");
  if (!Buffer.isBuffer(req.body) || !req.body.length) {
    return res.status(400).json({ error: "Empty file body" });
  }
  const text = await extractFromFile(req.body, filename);
  res.status(201).json(await rag.ingest({ title: filename || "untitled", text, metadata: { filename } }));
}));

// Ingest a document: { title?, text, metadata? }
app.post("/documents", wrap(async (req, res) => {
  const { title, text, metadata } = req.body ?? {};
  if (typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ error: "`text` (string) is required" });
  }
  if (looksBinary(text)) {
    return res.status(400).json({ error: "`text` looks like binary data, not text" });
  }
  res.status(201).json(await rag.ingest({ title, text, metadata }));
}));

app.get("/documents", wrap(async (req, res) => {
  res.json(await store.listDocuments());
}));

app.delete("/documents/:id", wrap(async (req, res) => {
  const ok = await store.deleteDocument(req.params.id);
  if (!ok) return res.status(404).json({ error: "Not found" });
  res.status(204).end();
}));

// Ask: { question, topK?, docIds?, history?, stream? }
app.post("/query", wrap(async (req, res) => {
  const { question, topK, docIds, history, stream, sessionId } = req.body ?? {};
  if (typeof question !== "string" || !question.trim()) {
    return res.status(400).json({ error: "`question` (string) is required" });
  }
  const opts = { topK, docIds, history, sessionId };

  if (!stream) return res.json(await rag.ask(question, opts));

  // Server-Sent Events
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  const controller = new AbortController();
  res.on("close", () => controller.abort());
  try {
    for await (const evt of rag.askStream(question, opts, controller.signal)) {
      res.write(`data: ${JSON.stringify(evt)}\n\n`);
    }
  } catch (err) {
    if (!controller.signal.aborted) {
      res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`);
    }
  }
  res.end();
}));

app.get("/sessions/:id", (req, res) => {
  res.json({ sessionId: req.params.id, messages: sessions.getHistory(req.params.id) });
});

app.delete("/sessions/:id", (req, res) => {
  sessions.clearSession(req.params.id);
  res.status(204).end();
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return res.end();
  res.status(err.status || 500).json({ error: err.message || "Internal error" });
});

app.listen(config.port, () => {
  console.log(`RAG API listening on http://localhost:${config.port}`);
  console.log(`LLM: ${config.llmModel} | Embeddings: ${config.embedModel}`);
});
