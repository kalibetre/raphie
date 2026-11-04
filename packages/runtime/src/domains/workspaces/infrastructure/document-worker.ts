import { parentPort, workerData } from "node:worker_threads";

import {
  formatFromBytes,
  initSync,
  toMarkdownBytes,
} from "@firecrawl/anydoc-wasm";
import * as pdfWorker from "pdfjs-dist/build/pdf.worker.mjs";

async function readPdfText(bytes: Uint8Array) {
  // PDF.js only needs its rendering matrix when rendering, not extracting text.
  if (!globalThis.DOMMatrix)
    Object.assign(globalThis, { DOMMatrix: class DOMMatrix {} });
  Object.assign(globalThis, { pdfjsWorker: pdfWorker });
  const { getDocument } = await import("pdfjs-dist/build/pdf.mjs");
  const loading = getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    stopAtErrors: true,
  });
  try {
    const pdf = await loading.promise;
    let text = "";
    const missing: number[] = [];
    let processed = 0;
    for (
      let page = 1;
      page <= pdf.numPages && page <= 200 && text.length < 1_000_000;
      page++
    ) {
      const content = await (await pdf.getPage(page)).getTextContent();
      const body = content.items
        .flatMap((item) =>
          "str" in item ? [item.str + (item.hasEOL ? "\n" : " ")] : [],
        )
        .join("")
        .trim();
      if (!body) missing.push(page);
      text += `\n\n## Page ${page}\n\n${body}`;
      processed = page;
    }
    return {
      markdown: text,
      warning: `AnyDoc reported pages needing OCR. PDF text extraction is partial; empty or scanned pages may be missing. Pages with no extracted text: ${missing.join(", ") || "none detected"}. ${processed < pdf.numPages ? `Only the first ${processed} of ${pdf.numPages} pages were processed.` : ""}`,
    };
  } finally {
    await loading.destroy();
  }
}

async function readDocument() {
  const { bytes, name, offset } = workerData as {
    bytes: Uint8Array;
    name: string;
    offset: number;
  };
  const wasmUrl = Bun.isStandaloneExecutable
    ? new URL("./raphie-anydoc.wasm", import.meta.url)
    : new URL(
        "./anydoc_wasm_bg.wasm",
        import.meta.resolve("@firecrawl/anydoc-wasm"),
      );
  initSync({ module: await Bun.file(wasmUrl).arrayBuffer() });
  const format =
    formatFromBytes(bytes) ??
    (name.toLowerCase().endsWith(".csv") ? "csv" : undefined);
  if (!format)
    throw Object.assign(new Error("Unsupported document format."), {
      code: "unsupported",
    });
  let markdown: string;
  let warning: string | undefined;
  try {
    markdown = toMarkdownBytes(bytes, format);
  } catch (error) {
    if (
      format !== "pdf" ||
      !(
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "needsOcr"
      )
    )
      throw error;
    ({ markdown, warning } = await readPdfText(bytes));
  }
  const start = Math.min(offset, markdown.length);
  const end = Math.min(start + 16000, markdown.length);
  return {
    format,
    content: markdown.slice(start, end),
    offset: start,
    nextOffset: end < markdown.length ? end : null,
    totalCharacters: markdown.length,
    ...(warning ? { warning } : {}),
  };
}

readDocument().then(
  (result) => parentPort!.postMessage({ result }),
  (error: unknown) => {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "unavailable";
    const messages: Record<string, string> = {
      needsOcr:
        "This PDF contains scanned pages that need OCR; OCR is not available.",
      encrypted: "This document is encrypted or password-protected.",
      malformed: "This document is malformed or could not be parsed.",
      unsupported: "This document format is not supported.",
      resourceLimit: "This document exceeds the converter's safety limits.",
      missingPart: "This document is missing required content.",
    };
    parentPort!.postMessage({
      error: messages[code] ?? "Document conversion failed.",
      code,
    });
  },
);
