# RAG API

Express + Ollama + Qdrant. LLM: `scb10x/llama3.1-typhoon2-8b-instruct`, embeddings: `bge-m3`, vector DB: Qdrant.

Easiest way to run everything: `docker compose up -d --build` (starts ollama, qdrant, api).
Running locally with `npm start` needs Qdrant at `QDRANT_URL` (default `http://localhost:6333`).

## Setup

```powershell
ollama pull scb10x/llama3.1-typhoon2-8b-instruct
ollama pull bge-m3
npm.cmd install
Copy-Item .env.example .env
npm.cmd start
```

## Endpoints

- `GET /health`
- `POST /documents` `{ "title": "...", "text": "...", "metadata": {} }`
- `GET /documents`
- `DELETE /documents/:id`
- `POST /query` `{ "question": "...", "topK": 4, "docIds": [], "history": [], "stream": false }`
  - `stream: true` returns SSE events: `sources`, `token`, `done`, `error`

Set `API_KEY` in `.env` to require an `x-api-key` header.

## Example

```powershell
curl.exe -X POST http://localhost:3000/documents -H "Content-Type: application/json" -d '{\"title\":\"test\",\"text\":\"กรุงเทพเป็นเมืองหลวงของประเทศไทย\"}'
curl.exe -X POST http://localhost:3000/query -H "Content-Type: application/json" -d '{\"question\":\"เมืองหลวงของไทยคืออะไร\"}'
```
