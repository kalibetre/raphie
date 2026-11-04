declare module "pdfjs-dist/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}

declare module "pdfjs-dist/build/pdf.mjs" {
  export { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
}
