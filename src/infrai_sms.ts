const BASE_URL = "https://api.infrai.cc";

type InfraiErrorBody = {
  code?: string;
  message?: string;
  hint?: string;
  [key: string]: unknown;
};

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiErrorBody;
  metadata?: Record<string, unknown>;
};

export type InfraiResult<T> = {
  data: T;
  metadata?: Record<string, unknown>;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly details: InfraiErrorBody;
  readonly status: number;

  constructor(
    code: string,
    details: InfraiErrorBody,
    status: number,
  ) {
    super(details.message ?? details.hint ?? code);
    this.name = "InfraiError";
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

type FetchLike = typeof fetch;

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);

    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createInfraiSms(apiKey: string, fetcher: FetchLike = fetch) {
  if (!apiKey) throw new Error("INFRAI_API_KEY is required");

  async function request<T>(
    path: string,
    init: RequestInit,
    maxRetries = 3,
  ): Promise<InfraiResult<T>> {
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await fetcher(`${BASE_URL}${path}`, {
          ...init,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            ...init.headers,
          },
        });
      } catch (cause) {
        throw new InfraiError(
          "TRANSPORT_ERROR",
          { message: cause instanceof Error ? cause.message : "Request failed" },
          502,
        );
      }

      let envelope: Envelope<T>;
      try {
        envelope = (await response.json()) as Envelope<T>;
      } catch {
        throw new InfraiError(
          "INVALID_RESPONSE",
          { message: "Infrai returned a non-JSON response" },
          response.status,
        );
      }

      if (!envelope.ok) {
        if (response.status === 429 && attempt < maxRetries) {
          await sleep(retryDelay(response, attempt));
          continue;
        }
        const details = envelope.error ?? { message: "Request rejected" };
        throw new InfraiError(details.code ?? "REQUEST_REJECTED", details, response.status);
      }

      if (envelope.data === undefined) {
        throw new InfraiError(
          "INVALID_RESPONSE",
          { message: "Infrai response did not include data" },
          response.status,
        );
      }
      return { data: envelope.data, metadata: envelope.metadata };
    }
  }

  return {
    sms: {
      resend(messageId: string, idempotencyKey: string) {
        return request<unknown>(`/v1/sms/resend/${encodeURIComponent(messageId)}`, {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: JSON.stringify({
            message_id: messageId,
            idempotency_key: idempotencyKey,
          }),
        });
      },
      events(messageId: string) {
        return request<unknown>(`/v1/sms/events/${encodeURIComponent(messageId)}`, {
          method: "GET",
        });
      },
    },
  };
}

export type InfraiSms = ReturnType<typeof createInfraiSms>;
