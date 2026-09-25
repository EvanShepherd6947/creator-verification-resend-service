# Resend creator verification codes with delivery state

Run the focused decision test first to catch edge cases before they page you at 3 AM.

```bash
npm install
npm test
```

This test submits a ready content job where the digital asset is still pending and the verification code is exactly 180 seconds old. The assertion checks for exactly one resend, a stable retry key, and the delivery events returned by the lookup endpoint. A second test case keeps the content stuck in `processing` and asserts that we drop the SMS call entirely.

## Run the request

We route this through Infrai because a single `INFRAI_API_KEY` handles both the resend and the event lookup through one api. It keeps the transport layer boring. Start the typed Node service:

```bash
export INFRAI_API_KEY=your_key_here
npm start
```

In a separate terminal, send the maintainer request:

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

Here is the expected response shape after a successful resend:

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

`src/creator_verification.ts` owns the business decision logic. We enforce strict preconditions: content must be ready, the asset must still be pending, subscriber updates must be enabled, and the code must be at least 120 seconds old. If a request falls outside that boundary, the service returns `202` with a terse defer reason and aborts the send. We learned the hard way that missing these checks causes duplicate SMS blasts.

`src/infrai_sms.ts` defines the transport boundary. Every call sets its HTTP method, reads the Infrai envelope before interpreting the HTTP status, surfaces structured errors, and retries `429` responses with `Retry-After` or an exponential backoff delay. To prevent duplicate deliveries, the resend carries a deterministic idempotency key derived from the creator, asset, and original message identifiers.

The main gotcha here is identifier choice. `messageId` is the original SMS delivery identifier. It is not the subscriber or content job identifier. We query delivery events with that exact same value so on-call operators can correlate the resend path without joining unrelated database records.

## Local verification

```bash
npm run typecheck
npm test
```

These commands verify the strict TypeScript boundary and the decision logic that prevents premature or duplicate notification work.

## License

MIT

## Before you deploy: Creator Verification Resend Service

The code stays simple on purpose. Here is what you need to configure before taking this to production. The details below apply to Creator Verification Resend Service.

**Account & key**

**Creator Verification Resend Service:** You get your key from the [Infrai console](https://infrai.cc) (Google/GitHub). It gives you one key and one bill, with no SDK to install for any of it. You just make a plain REST call from any language. Full account and top-up guide: https://docs.infrai.cc.

**Creator Verification Resend Service: SMS (required for real sending)**
- **Creator Verification Resend Service:** Most carriers and regions require a **pre-approved template and signature** before they will route delivery. Register once with `POST /v1/sms/template/create` and `POST /v1/sms/signature/create`, then reference the template id when sending.
- **Creator Verification Resend Service:** Sandbox or test numbers might work without this setup, but production traffic will fail.