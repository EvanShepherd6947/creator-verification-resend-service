import { z } from "zod";
import type { InfraiSms } from "./infrai_sms.js";

export const resendRequestSchema = z.object({
  creatorId: z.string().min(1),
  subscriberId: z.string().min(1),
  assetId: z.string().min(1),
  contentJobId: z.string().min(1),
  messageId: z.string().min(1),
  contentState: z.enum(["processing", "ready", "rejected"]),
  assetDeliveryState: z.enum(["pending", "delivered"]),
  subscriberUpdatesEnabled: z.boolean(),
  codeAgeSeconds: z.number().int().nonnegative(),
});

export type ResendRequest = z.infer<typeof resendRequestSchema>;

export type ResendDecision =
  | {
      decision: "deferred";
      reason: "content_processing" | "asset_already_delivered" | "subscriber_updates_disabled" | "code_not_stuck";
    }
  | {
      decision: "resent";
      creatorId: string;
      subscriberId: string;
      assetId: string;
      contentJobId: string;
      messageId: string;
      deliveryState: "events_observed";
      deliveryEvents: unknown;
      metadata?: Record<string, unknown>;
    };

export function decideResend(input: ResendRequest): ResendDecision | undefined {
  if (input.contentState !== "ready") {
    return { decision: "deferred", reason: "content_processing" };
  }
  if (input.assetDeliveryState === "delivered") {
    return { decision: "deferred", reason: "asset_already_delivered" };
  }
  if (!input.subscriberUpdatesEnabled) {
    return { decision: "deferred", reason: "subscriber_updates_disabled" };
  }
  if (input.codeAgeSeconds < 120) {
    return { decision: "deferred", reason: "code_not_stuck" };
  }
  return undefined;
}

export async function resendCreatorVerification(
  infrai: InfraiSms,
  input: ResendRequest,
): Promise<ResendDecision> {
  const deferred = decideResend(input);
  if (deferred) return deferred;

  const idempotencyKey = `creator-verification:${input.creatorId}:${input.assetId}:${input.messageId}`;
  const resend = await infrai.sms.resend(input.messageId, idempotencyKey);
  const events = await infrai.sms.events(input.messageId);

  return {
    decision: "resent",
    creatorId: input.creatorId,
    subscriberId: input.subscriberId,
    assetId: input.assetId,
    contentJobId: input.contentJobId,
    messageId: input.messageId,
    deliveryState: "events_observed",
    deliveryEvents: events.data,
    metadata: resend.metadata,
  };
}
