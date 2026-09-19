import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ZodError } from "zod";
import { resendCreatorVerification, resendRequestSchema } from "./creator_verification.js";
import { createInfraiSms, InfraiError } from "./infrai_sms.js";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("INFRAI_API_KEY is required");

const infrai = createInfraiSms(apiKey);
const port = Number(process.env.PORT ?? 3000);

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/verification/resend") {
    sendJson(response, 404, { error: "route_not_found" });
    return;
  }

  try {
    const input = resendRequestSchema.parse(await readJson(request));
    const result = await resendCreatorVerification(infrai, input);
    sendJson(response, result.decision === "resent" ? 200 : 202, result);
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      sendJson(response, 400, {
        error: "invalid_request",
        details: error instanceof ZodError ? error.flatten() : undefined,
      });
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      sendJson(response, status, { error: error.code, message: error.message });
      return;
    }
    sendJson(response, 500, { error: "internal_error" });
  }
});

server.listen(port, () => {
  console.log(`creator verification service listening on http://localhost:${port}`);
});
