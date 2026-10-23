import { randomUUID } from "node:crypto";
import { config } from "./config.js";

/**
 * Qdrant-backed vector store (REST API, no extra dependency).
 * One collection holds every chunk. Each point payload:
 *   { docId, title, chunkIndex, text, createdAt, metadata }
 * A "document" is the set of points sharing the same docId.
 */
let ready = null; // promise: collection exists

async function qdrant(path, { method = "POST", body, okStatuses = [] } = {}) {
  const res = await fetch(`${config.qdrantUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(config.qdrantApiKey && { "api-key": config.qdrantApiKey }),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && !okStatuses.includes(res.status)) {
    throw new Error(`Qdrant ${method} ${path} failed (${res.status}): ${await res.text()}`);
  }
  return res;
}

const docFilter = (docId) => ({ must: [{ key: "docId", match: { value: docId } }] });

async function collectionExists() {
  const res = await qdrant(`/collections/${config.qdrantCollection}`, {
    method: "GET",
    okStatuses: [404],
  });
  return res.ok;
}

/** Create the collection (sized to the embedding dimension) on first write. */
function ensureCollection(dim) {
  ready ??= (async () => {
    if (!(await collectionExists())) {
      await qdrant(`/collections/${config.qdrantCollection}`, {
        method: "PUT",
        body: { vectors: { size: dim, distance: "Cosine" } },
        okStatuses: [409], // created concurrently
      });
    }
    await qdrant(`/collections/${config.qdrantCollection}/index?wait=true`, {
      method: "PUT",
      body: { field_name: "docId", field_schema: "keyword" },
    });
  })().catch((err) => {
    ready = null; // retry next time
    throw err;
  });
  return ready;
}

export async function addDocument({ id, title, metadata, chunks, embeddings }) {
  await ensureCollection(embeddings[0].length);
  const createdAt = new Date().toISOString();
  const points = chunks.map((text, i) => ({
    id: randomUUID(),
    vector: embeddings[i],
    payload: { docId: id, title, chunkIndex: i, text, createdAt, metadata: metadata ?? {} },
  }));
  // Upsert in batches to keep request bodies small
  for (let i = 0; i < points.length; i += 64) {
    await qdrant(`/collections/${config.qdrantCollection}/points?wait=true`, {
      method: "PUT",
      body: { points: points.slice(i, i + 64) },
    });
  }
  return { id, title, metadata: metadata ?? {}, chunkCount: chunks.length, createdAt };
}

export async function listDocuments() {
  if (!(await collectionExists())) return [];
  const docs = new Map();
  let offset = null;
  do {
    const res = await qdrant(`/collections/${config.qdrantCollection}/points/scroll`, {
      body: {
        limit: 512,
        offset,
        with_vector: false,
        with_payload: { include: ["docId", "title", "createdAt", "metadata"] },
      },
    });
    const { result } = await res.json();
    for (const p of result.points) {
      const { docId, title, createdAt, metadata } = p.payload;
      const d = docs.get(docId) ?? { id: docId, title, createdAt, metadata, chunkCount: 0 };
      d.chunkCount++;
      docs.set(docId, d);
    }
    offset = result.next_page_offset;
  } while (offset);
  return [...docs.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getDocument(id) {
  if (!(await collectionExists())) return null;
  const res = await qdrant(`/collections/${config.qdrantCollection}/points/count`, {
    body: { filter: docFilter(id), exact: true },
  });
  const { result } = await res.json();
  return result.count ? { id, chunkCount: result.count } : null;
}

export async function deleteDocument(id) {
  const doc = await getDocument(id);
  if (!doc) return false;
  await qdrant(`/collections/${config.qdrantCollection}/points/delete?wait=true`, {
    body: { filter: docFilter(id) },
  });
  return true;
}

export async function search(queryEmbedding, topK = 4, docIds = null) {
  if (!(await collectionExists())) return [];
  const filter = docIds?.length
    ? { must: [{ key: "docId", match: { any: docIds } }] }
    : undefined;
  const res = await qdrant(`/collections/${config.qdrantCollection}/points/search`, {
    body: { vector: queryEmbedding, limit: topK, with_payload: true, filter },
  });
  const { result } = await res.json();
  return result.map((r) => ({
    id: `${r.payload.docId}:${r.payload.chunkIndex}`,
    docId: r.payload.docId,
    title: r.payload.title,
    text: r.payload.text,
    score: r.score,
  }));
}

/** For /health: is Qdrant reachable? */
export async function ping() {
  try {
    const res = await qdrant("/readyz", { method: "GET", okStatuses: [503] });
    return res.ok;
  } catch {
    return false;
  }
}
