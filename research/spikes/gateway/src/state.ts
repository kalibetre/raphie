import { defineDoc } from '@earendil-works/pi-durable';
import type { FileRef } from './files.ts';

export type Source = 'web' | 'discord';
export type Approval = {
  id: string; requestKey: string; fingerprint: string; text: string;
  source: Source; files: FileRef[]; createdAt: number; expiresAt: number;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  decidedVia: Source | null; completedAt: number | null; results: FileRef[];
  effectCount: number;
};
export type Delivery = {
  id: string; approvalId: string; kind: 'approval' | 'resolved' | 'result';
  threadId: string; status: 'pending' | 'sending' | 'sent' | 'uncertain';
  messageId: string | null; error: string | null;
};
export type GatewayState = { approvals: Approval[]; deliveries: Delivery[] };
export const State = defineDoc<GatewayState>({
  kind: 'raphie.gateway', version: 1, scope: 'session',
  initial: () => ({ approvals: [], deliveries: [] }),
});

export class InputError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
