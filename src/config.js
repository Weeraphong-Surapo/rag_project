export const config = {
  port: Number(process.env.PORT || 3000),
  ollamaUrl: process.env.OLLAMA_URL || "http://localhost:11434",
  llmModel: process.env.LLM_MODEL || "scb10x/llama3.1-typhoon2-8b-instruct",
  embedModel: process.env.EMBED_MODEL || "bge-m3",
  chunkSize: Number(process.env.CHUNK_SIZE || 800),
  chunkOverlap: Number(process.env.CHUNK_OVERLAP || 100),
  topK: Number(process.env.TOP_K || 4),
  // chunks scoring below this cosine similarity are dropped (not used, not shown as sources)
  minScore: Number(process.env.MIN_SCORE || 0.45),
  apiKey: process.env.API_KEY || "",
  qdrantUrl: (process.env.QDRANT_URL || "http://localhost:6333").replace(/\/$/, ""),
  qdrantApiKey: process.env.QDRANT_API_KEY || "",
  qdrantCollection: process.env.QDRANT_COLLECTION || "rag_chunks",
};
