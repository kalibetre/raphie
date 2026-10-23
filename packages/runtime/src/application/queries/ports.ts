import type {
  Page,
  RuntimeInfo,
  SessionActivity,
  SessionApproval,
  SessionObservation,
  SessionSummary,
  SessionTurn,
} from "@raphie/contracts";

import type { ActorContext } from "../access/actors.ts";

export interface ClientQueries {
  info(actor: ActorContext): Promise<RuntimeInfo>;
  sessions(
    actor: ActorContext,
    after?: string,
    limit?: number,
  ): Promise<Page<SessionSummary>>;
  session(actor: ActorContext, id: string): Promise<SessionObservation>;
  history(
    actor: ActorContext,
    id: string,
    before?: string,
    limit?: number,
  ): Promise<Page<SessionTurn>>;
  approvals(actor: ActorContext, id: string): Promise<SessionApproval[]>;
  activity(
    actor: ActorContext,
    before?: string,
    limit?: number,
  ): Promise<Page<SessionActivity>>;
  resolveLegacy(actor: ActorContext, id: number): Promise<string>;
}
