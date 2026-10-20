import type { Attachment } from "@raphie/contracts";

export interface AttachmentStore {
  put(name: string, bytes: Uint8Array): Promise<Attachment>;
  read(id: string): Promise<Uint8Array>;
}
