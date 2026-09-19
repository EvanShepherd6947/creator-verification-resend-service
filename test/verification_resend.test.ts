import assert from "node:assert/strict";
import test from "node:test";
import { resendCreatorVerification, type ResendRequest } from "../src/creator_verification.js";
import type { InfraiSms } from "../src/infrai_sms.js";

const eligibleRequest: ResendRequest = {
  creatorId: "creator-42",
  subscriberId: "subscriber-8",
  assetId: "asset-video-17",
  contentJobId: "encode-91",
  messageId: "msg-123",
  contentState: "ready",
  assetDeliveryState: "pending",
  subscriberUpdatesEnabled: true,
  codeAgeSeconds: 180,
};

test("defers while content processing is incomplete and sends nothing", async () => {
  let calls = 0;
  const infrai = {
    sms: {
      resend: async () => {
        calls += 1;
        return { data: {} };
      },
      events: async () => {
        calls += 1;
        return { data: [] };
      },
    },
  } as InfraiSms;

  const result = await resendCreatorVerification(infrai, {
    ...eligibleRequest,
    contentState: "processing",
  });

  assert.deepEqual(result, { decision: "deferred", reason: "content_processing" });
  assert.equal(calls, 0);
});

test("resends an eligible code once and exposes delivery events", async () => {
  const calls: Array<{ operation: string; value: string }> = [];
  const infrai = {
    sms: {
      resend: async (messageId: string, idempotencyKey: string) => {
        calls.push({ operation: "resend", value: `${messageId}|${idempotencyKey}` });
        return { data: { accepted: true }, metadata: { provider: "sms-route" } };
      },
      events: async (messageId: string) => {
        calls.push({ operation: "events", value: messageId });
        return { data: [{ state: "delivered" }] };
      },
    },
  } as InfraiSms;

  const result = await resendCreatorVerification(infrai, eligibleRequest);

  assert.deepEqual(calls, [
    {
      operation: "resend",
      value: "msg-123|creator-verification:creator-42:asset-video-17:msg-123",
    },
    { operation: "events", value: "msg-123" },
  ]);
  assert.equal(result.decision, "resent");
  if (result.decision === "resent") {
    assert.equal(result.deliveryState, "events_observed");
    assert.deepEqual(result.deliveryEvents, [{ state: "delivered" }]);
  }
});
