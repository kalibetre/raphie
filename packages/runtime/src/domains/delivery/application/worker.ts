import type { DeliveryIntent, DeliveryOperation } from "../domain/model.ts";

export interface ChannelDeliveryQueues {
  forConnection(connectionId: string): DeliveryQueue;
}

export type RenderDelivery = (intent: DeliveryIntent) => Promise<string[]>;

export interface DeliveryQueue {
  claim(render: RenderDelivery): Promise<DeliveryOperation | null>;
  settle(id: string, messageId: string | null): Promise<void>;
}

/** A send failure has an unknown platform outcome. It must never trigger a blind retry. */
export function createDeliveryWorker(
  queue: DeliveryQueue,
  render: RenderDelivery,
  send: (payload: string) => Promise<string>,
) {
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    try {
      for (let operation; (operation = await queue.claim(render));) {
        let messageId: string | null = null;
        try {
          messageId = await send(operation.payload);
        } catch {
          /* Persist uncertainty below. */
        }
        await queue.settle(operation.id, messageId);
      }
    } finally {
      running = false;
    }
  };
}
