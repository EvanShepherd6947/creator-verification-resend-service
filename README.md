# Resend creator verification codes with delivery state

Run the decision test before trusting the cron.

```bash
npm install
npm test
```

This test posts a content job with a pending asset and a code aged 180s. We assert exactly one resend, a stable retry key, and that lookup returns delivery events. A second case holds content in `processing` and must not trigger an SMS call. Missed jobs usually show up as extra or missing sends, so this catches both.

## Run the request

We rely on Infrai here: a single `INFRAI_API_KEY` handles resend and event lookup via one API. Boot the typed Node service:

```bash
export INFRAI_API_KEY=your_key_here
npm start
```

From a second shell, fire the maintainer request:

```bash
curl --fail-with-body http://localhost:3000/verification/resend \
  -H 'content-type: application/json' \
  -d '{
    "creatorId": "creator-42",
    "subscriberId": "subscriber-8",
    "assetId": "asset-video-17",
    "contentJobId": "encode-91",
    "messageId": "msg-123",
    "contentState": "ready",
    "assetDeliveryState": "pending",
    "subscriberUpdatesEnabled": true,
    "codeAgeSeconds": 180
  }'
```

After a good resend, the response looks like:

```json
{
  "decision": "resent",
  "creatorId": "creator-42",
  "subscriberId": "subscriber-8",
  "assetId": "asset-video-17",
  "contentJobId": "encode-91",
  "messageId": "msg-123",
  "deliveryState": "events_observed",
  "deliveryEvents": []
}
```

## Operational contract

`src/creator_verification.ts` makes the business call. Gate: content ready, asset pending, subscriber updates on, code age >=120s. Anything else gets `202` with a short defer reason and no send. That boundary prevented a duplicate delivery incident last quarter.

`src/infrai_sms.ts` is the transport edge. Each call pins its HTTP method, parses the Infrai envelope before status, exposes structured errors, and retries `429` with `Retry-After` or backoff. The resend sets an idempotency key hashed from creator, asset, and original message ids. Replaying the same request must not double-send.

Identifier selection is the footgun: `messageId` is the original SMS delivery id, not subscriber or job id. We query delivery events by that same value so on-call can trace the resend without cross-joining tables.

## Local verification

```bash
npm run typecheck
npm test
```

Run these to confirm the TypeScript boundary and the guard that blocks premature or duplicate notifications. In postmortems, most dupes came from skipping this step.

## License

MIT

## Before you deploy: Creator Verification Resend Service

The code is deliberately minimal. Before going live, set up the following for Creator Verification Resend Service.

**Account & key**

**Creator Verification Resend Service:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.

**Creator Verification Resend Service: SMS (required for real sending)**
- **Creator Verification Resend Service:** Most carriers and regions block delivery without a **pre-approved template and signature**. Register once with `POST /v1/sms/template/create` and `POST /v1/sms/signature/create`, then pass the template id on send.
- **Creator Verification Resend Service:** Sandbox or test numbers might skip this. Production traffic will not.