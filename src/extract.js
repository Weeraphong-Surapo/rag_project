import { extractText, getDocumentProxy } from "unpdf";

const TEXT_EXT = new Set([".txt", ".md", ".markdown", ".csv", ".json", ".log"]);

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

/** True if the string looks like decoded binary garbage rather than text. */
export function looksBinary(text) {
  if (!text) return false;
  const sample = text.slice(0, 5000);
  let junk = 0;
  for (const ch of sample) {
    const c = ch.codePointAt(0);
    if (c === 0xfffd || (c < 32 && c !== 9 && c !== 10 && c !== 13)) junk++;
  }
  return junk / sample.length > 0.02;
}

const TH = "\u0E00-\u0E7F";
// leading vowels (เ แ โ ใ ไ) and combining marks (ั ิ-ฺ ็-๎) never end a word,
// so a space right after them is an extraction artefact
const AFTER_NO_SPACE = new RegExp(`([เแโใไ\u0E31\u0E34-\u0E3A\u0E47-\u0E4E])[ \\t]+(?=[${TH}])`, "g");
// dependent vowels / marks never start a word, so a space right before them is an artefact
const BEFORE_NO_SPACE = new RegExp(`(?<=[${TH}])[ \\t]+(?=[ะาำ\u0E31\u0E34-\u0E3A\u0E47-\u0E4E])`, "g");

// Many Thai fonts store tone marks / upper vowels as Private Use Area glyph variants
// (U+F700-F71A, Adobe/Microsoft Thai PUA). They render fine but extract as invisible
// characters, which is why "ได้" came out as "ได". Map them back to standard Thai.
const THAI_PUA = {
  0xf700: 0x0e10, 0xf70f: 0x0e0d,
  0xf701: 0x0e34, 0xf702: 0x0e35, 0xf703: 0x0e36, 0xf704: 0x0e37,
  0xf705: 0x0e48, 0xf70a: 0x0e48, 0xf713: 0x0e48,
  0xf706: 0x0e49, 0xf70b: 0x0e49, 0xf714: 0x0e49,
  0xf707: 0x0e4a, 0xf70c: 0x0e4a, 0xf715: 0x0e4a,
  0xf708: 0x0e4b, 0xf70d: 0x0e4b, 0xf716: 0x0e4b,
  0xf709: 0x0e4c, 0xf70e: 0x0e4c, 0xf717: 0x0e4c,
  0xf710: 0x0e31, 0xf711: 0x0e4d, 0xf712: 0x0e47,
  0xf718: 0x0e38, 0xf719: 0x0e39, 0xf71a: 0x0e3a,
};

export function mapThaiPua(text) {
  return text.replace(/[\uF700-\uF71A]/g, (c) => String.fromCodePoint(THAI_PUA[c.codePointAt(0)] ?? 0x20));
}

/** Repair the stray spaces pdf.js inserts inside Thai words ("เงิ นไดสุ ทธิ " -> "เงินไดสุทธิ"). */
export function fixThaiSpacing(text) {
  return text
    .replace(AFTER_NO_SPACE, "$1")
    .replace(BEFORE_NO_SPACE, "")
    .normalize("NFC");
}

/** Extract plain text from an uploaded file buffer based on filename. */
export async function extractFromFile(buffer, filename = "") {
  const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";

  if (ext === ".pdf" || buffer.subarray(0, 5).toString("latin1") === "%PDF-") {
    let text;
    try {
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      ({ text } = await extractText(pdf, { mergePages: true }));
    } catch (err) {
      throw bad(`Cannot read PDF: ${err.message}`);
    }
    if (!text?.trim()) {
      throw bad("PDF has no extractable text (scanned image? OCR is required)");
    }
    return fixThaiSpacing(mapThaiPua(text));
  }

  if (!TEXT_EXT.has(ext)) {
    throw bad(`Unsupported file type "${ext || "unknown"}". Use PDF, TXT, MD, CSV or JSON.`);
  }
  const text = buffer.toString("utf8");
  if (looksBinary(text)) throw bad("File does not look like text");
  return text;
}
