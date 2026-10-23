import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { chunkText } from "./chunker.js";
import { embed, chat, chatStream } from "./ollama.js";
import * as store from "./vectorStore.js";
import * as sessions from "./sessions.js";

const EMBED_BATCH = 16;

export async function ingest({ title, text, metadata }) {
  const chunks = chunkText(text, config.chunkSize, config.chunkOverlap);
  if (!chunks.length) throw Object.assign(new Error("Empty text"), { status: 400 });

  const embeddings = [];
  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    embeddings.push(...(await embed(chunks.slice(i, i + EMBED_BATCH))));
  }
  return store.addDocument({
    id: randomUUID(),
    title: title || "untitled",
    metadata,
    chunks,
    embeddings,
  });
}

const SYSTEM_PROMPT =
  "คุณเป็นผู้ช่วยสนทนาที่ตอบคำถามเกี่ยวกับเอกสาร มีแหล่งข้อมูล 2 แหล่ง:\n" +
  "1) 'บริบท' ที่ดึงจากเอกสาร ใช้ตอบคำถามเชิงข้อเท็จจริงเกี่ยวกับเนื้อหาในเอกสาร ห้ามเดาหรือแต่งข้อมูลที่ไม่มีในบริบท " +
  "ถ้าบริบทไม่พอสำหรับคำถามเรื่องเนื้อหาเอกสาร ให้บอกว่าไม่พบข้อมูลในเอกสาร\n" +
  "2) 'ประวัติการสนทนา' (ข้อความก่อนหน้าในแชทนี้) ใช้ตอบคำถามเกี่ยวกับการสนทนาเอง เช่น " +
  "'ก่อนหน้านี้ฉันถามอะไร', 'สรุปที่คุยกันมา', 'ข้อที่แล้วว่าอย่างไร', 'อธิบายอีกครั้ง' " +
  "คำถามประเภทนี้ไม่ต้องใช้บริบทจากเอกสารและห้ามตอบว่าไม่มีข้อมูล\n" +
  "ตอบด้วยภาษาเดียวกับคำถาม ถ้าเป็นคำถามต่อเนื่อง ให้ใช้ทั้งประวัติการสนทนาและบริบทประกอบกัน\n" +
  "ตอบเฉพาะสิ่งที่ถาม สรุปด้วยภาษาของคุณเอง ห้ามคัดลอกบริบททั้งก้อนมาตอบ " +
  "ถ้าข้อความของผู้ใช้ไม่ใช่คำถาม (เช่น ขอบคุณ ทักทาย) ให้ตอบรับสั้นๆ ตามมารยาท\n" +
  "Use the document context for factual questions about the documents, and the conversation history " +
  "for questions about the chat itself. Never invent facts.";

const REWRITE_PROMPT =
  "จากประวัติการสนทนาและคำถามล่าสุด ให้เขียนคำถามล่าสุดใหม่เป็นคำถามเดี่ยวที่เข้าใจได้ในตัวเอง " +
  "โดยแทนที่คำสรรพนามหรือคำที่อ้างถึงสิ่งก่อนหน้า (เช่น 'อันนี้', 'แล้วอันที่สองล่ะ', 'it', 'that') ด้วยสิ่งที่หมายถึงจริง " +
  "ใช้ภาษาเดียวกับคำถามเดิม ตอบเฉพาะคำถามที่เขียนใหม่เท่านั้น ห้ามอธิบายเพิ่ม " +
  "ถ้าคำถามชัดเจนอยู่แล้วให้ตอบคำถามเดิมตามที่เป็น";

/** Turn a follow-up question into a standalone one so retrieval works. */
async function rewriteQuestion(question, history) {
  if (!history.length) return question;
  const transcript = history
    .map((m) => `${m.role === "user" ? "ผู้ใช้" : "ผู้ช่วย"}: ${m.content}`)
    .join("\n");
  try {
    const out = await chat(
      [
        { role: "system", content: REWRITE_PROMPT },
        { role: "user", content: `ประวัติการสนทนา:\n${transcript}\n\nคำถามล่าสุด: ${question}\n\nคำถามที่เขียนใหม่:` },
      ],
      { temperature: 0 }
    );
    const cleaned = out.trim().replace(/^["'“”]|["'“”]$/g, "");
    return cleaned && cleaned.length < 500 ? cleaned : question;
  } catch {
    return question; // never fail the request just because rewriting failed
  }
}

// Greetings / thanks / acknowledgements: no document lookup, just a short polite reply
const SMALL_TALK =
  /^(สวัสดี|หวัดดี|ดีครับ|ดีค่ะ|hello|hi|hey|ขอบคุณ|ขอบใจ|ขอบพระคุณ|thanks?|thank you|thx|ok|okay|โอเค|เข้าใจแล้ว|รับทราบ|ได้เลย|เยี่ยม|เก่งมาก|ดีมาก|ลาก่อน|บาย|bye|good\s?(morning|night|bye))/i;

export function isSmallTalk(q) {
  const t = q.trim().replace(/[\s!.?~ๆ]+$/g, "");
  return t.length <= 40 && SMALL_TALK.test(t);
}

const SMALL_TALK_NOTE =
  "ข้อความนี้เป็นการทักทายหรือขอบคุณ ไม่ใช่คำถามเกี่ยวกับเอกสาร ให้ตอบสั้นๆ 1-2 ประโยคอย่างสุภาพและเป็นกันเอง " +
  "และถามว่ามีอะไรให้ช่วยต่อไหม ห้ามยกเนื้อหาจากเอกสารหรือคำตอบก่อนหน้ามาซ้ำ";

async function prepare(question, { topK, docIds, history: clientHistory, sessionId }) {
  const sid = sessions.resolveId(sessionId);
  const history = Array.isArray(clientHistory) ? clientHistory : sessions.getHistory(sid);

  if (isSmallTalk(question)) {
    return {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...history,
        { role: "user", content: `${question}\n\n(${SMALL_TALK_NOTE})` },
      ],
      sources: [],
      sessionId: sid,
      standalone: question,
    };
  }

  const standalone = await rewriteQuestion(question, history);
  const [qEmb] = await embed(standalone);
  const hits = (await store.search(qEmb, topK || config.topK, docIds)).filter(
    (h) => h.score >= config.minScore
  );
  const context = hits
    .map((h, i) => `[${i + 1}] (${h.title})\n${h.text}`)
    .join("\n\n---\n\n");
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    {
      role: "user",
      content:
        `บริบทจากเอกสาร (ค้นด้วย: "${standalone}"):\n${context || "(ไม่พบข้อมูลที่เกี่ยวข้องในเอกสาร)"}\n\n` +
        `คำถาม: ${question}\n\nตอบคำถามข้างต้นให้ครบถ้วนโดยอ้างอิงจากบริบท (ห้ามพูดซ้ำคำถาม):`,
    },
  ];
  const sources = hits.map((h) => ({
    id: h.id,
    docId: h.docId,
    title: h.title,
    score: Number(h.score.toFixed(4)),
    text: h.text,
  }));
  return { messages, sources, sessionId: sid, standalone };
}

export async function ask(question, opts = {}) {
  const { messages, sources, sessionId, standalone } = await prepare(question, opts);
  const answer = await chat(messages);
  sessions.addTurn(sessionId, question, answer);
  return { answer, sources, sessionId, standaloneQuestion: standalone };
}

export async function* askStream(question, opts = {}, signal) {
  const { messages, sources, sessionId, standalone } = await prepare(question, opts);
  yield { type: "sources", sources, sessionId, standaloneQuestion: standalone };
  let answer = "";
  for await (const token of chatStream(messages, {}, signal)) {
    answer += token;
    yield { type: "token", token };
  }
  if (answer) sessions.addTurn(sessionId, question, answer);
  yield { type: "done" };
}
