import { defineTask } from '@earendil-works/pi-durable';
import type { TaskRuntime } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { State } from './state.ts';
import type { Approval, GatewayState, Delivery } from './state.ts';
import type { Files } from './files.ts';

type Input = { approvalId: string };
type Checkpoint = { phase: 'wait' } | { phase: 'effect' };

export function enqueue(state: GatewayState, approval: Approval, kind: Delivery['kind'], threadId: string | null) {
  // Pin follow-ups to the persisted original destination, including after a
  // restart, a web decision, or a change to the configured notification channel.
  threadId = state.deliveries.find(d => d.approvalId === approval.id && d.kind === 'approval')?.threadId ?? threadId;
  if (threadId) state.deliveries.push({
    id: `${approval.id}:${kind}`, approvalId: approval.id, kind, threadId,
    status: 'pending', messageId: null, error: null,
  });
}

/** The released 1.3.0 has invocation-bound watches, not the newer sleepUntil API. */
async function waitForDecision(runtime: TaskRuntime<Input, Checkpoint, null, object>, id: string) {
  const watch = await runtime.watchDoc(State, context);
  if (!watch) throw new Error('Missing gateway state.');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let aborted: () => void = () => {};
  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); runtime.signal.removeEventListener('abort', aborted); };
      const done = () => { cleanup(); resolve(); };
      aborted = () => { cleanup(); reject(new Error('Workflow invocation stopped.')); };
      const inspect = (value: Readonly<GatewayState> | null) => {
        const approval = value?.approvals.find(a => a.id === id);
        if (!approval || approval.status !== 'pending') done();
      };
      runtime.signal.addEventListener('abort', aborted, { once: true });
      const approval = watch.value?.approvals.find(a => a.id === id);
      timer = setTimeout(done, Math.max(0, (approval?.expiresAt ?? 0) - runtime.now()));
      watch.start(async value => inspect(value));
      inspect(watch.value);
      if (runtime.signal.aborted) aborted();
    });
  } finally {
    clearTimeout(timer);
    runtime.signal.removeEventListener('abort', aborted);
    await watch.stop();
  }
}

export function deliveryWorkflow(files: Files, threadId: string | null, beforeEffectCommit?: () => Promise<void>) {
  return defineTask<Input, Checkpoint, null>({
    name: 'raphie.approved-file-delivery', version: 1,
    initial: () => ({ phase: 'wait' }),
    phases: {
      wait: async (task, runtime, ctx) => {
        await waitForDecision(runtime, task.input.approvalId);
        await runtime.commit(async tx => {
          const state = await tx.doc(State);
          const approval = state.approvals.find(a => a.id === task.input.approvalId)!;
          if (approval.status === 'pending') {
            approval.status = 'expired';
            enqueue(state, approval, 'resolved', threadId);
          }
          return approval.status === 'approved'
            ? { status: 'running', checkpoint: { phase: 'effect' } }
            : { status: 'terminal', outcome: { status: 'completed', result: null } };
        }, ctx);
      },
      effect: async (task, runtime, ctx) => {
        const state = await runtime.snapshot(State, ctx);
        const approval = state!.approvals.find(a => a.id === task.input.approvalId)!;
        // Deterministic filesystem effect. No email, calendar, or model calls in this experiment.
        const results = approval.files.length
          ? await Promise.all(approval.files.map(async file => files.put(`approved-${file.name}`, await files.read(file.id))))
          : [await files.put('approved-note.txt', Buffer.from(approval.text, 'utf8'))];
        await beforeEffectCommit?.();
        // A crash between writing the blob and this commit reuses the same content-addressed blob.
        await runtime.commit(async tx => {
          const current = await tx.doc(State);
          const item = current.approvals.find(a => a.id === approval.id)!;
          if (!item.completedAt) {
            item.results = results; item.completedAt = runtime.now(); item.effectCount = 1;
            enqueue(current, item, 'result', threadId);
          }
          return { status: 'terminal', outcome: { status: 'completed', result: null } };
        }, ctx);
      },
    },
    abort: async (_task, runtime, ctx) => {
      await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'aborted' } }), ctx);
    },
  });
}
