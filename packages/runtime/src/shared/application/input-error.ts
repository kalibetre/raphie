export class InputError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
    this.code =
      (
        {
          403: "forbidden",
          404: "not_found",
          409: "conflict",
          413: "too_large",
          503: "unavailable",
        } as Record<number, string>
      )[status] ?? "invalid_request";
  }
}
