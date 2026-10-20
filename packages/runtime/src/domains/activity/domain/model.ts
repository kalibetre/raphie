export type ActivityEvent = {
  id: number;
  at: number;
  attemptId: string;
  conversationId: number | null;
  runId: string | null;
  operationId: string | null;
  pluginId: string | null;
  type: string;
  summary: string;
  detailsJson: string;
};
