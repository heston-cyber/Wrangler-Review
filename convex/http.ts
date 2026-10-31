import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { mcpOther, mcpPost } from "./mcp";
import { post as wsMcpPost, other as wsMcpOther } from "./wsMcp";
import { callback as dropboxCallback, webhookNotify, webhookVerify } from "./dropbox";
import { feed as registerFeed } from "./register";
import { stop as emailStop } from "./emails";
import { og } from "./og";
import { ip as wsS0Ip } from "./wsS0";
import { api as wsApi, preflight as wsPreflight } from "./signing";
import { verifyHttp as wsVerify } from "./signDone";
import { callback as wsDropboxCallback } from "./wsArchive";
import { connectWebhook } from "./payments";
import { webflow as webflowLeads } from "./leads";

const http = httpRouter();
auth.addHttpRoutes(http);

// The Claude connector (MCP over Streamable HTTP).
http.route({ path: "/mcp", method: "POST", handler: mcpPost });
http.route({ path: "/mcp", method: "GET", handler: mcpOther });
http.route({ path: "/mcp", method: "DELETE", handler: mcpOther });
// Same thing with the key in the address, for Claude accounts without the "Request headers" setting.
http.route({ pathPrefix: "/mcp/", method: "POST", handler: mcpPost });
http.route({ pathPrefix: "/mcp/", method: "GET", handler: mcpOther });
http.route({ pathPrefix: "/mcp/", method: "DELETE", handler: mcpOther });

// Wrangler Sign's own connector (S4), with its own keys (ws_…).
for (const method of ["POST", "GET", "DELETE"] as const) {
  const handler = method === "POST" ? wsMcpPost : wsMcpOther;
  http.route({ path: "/ws-mcp", method, handler });
  http.route({ pathPrefix: "/ws-mcp/", method, handler });
}

// Dropbox: the Connect Dropbox return address, and the webhook (GET = one-time check, POST = "something changed").
http.route({ path: "/dropbox/callback", method: "GET", handler: dropboxCallback });
http.route({ path: "/dropbox/webhook", method: "GET", handler: webhookVerify });
http.route({ path: "/dropbox/webhook", method: "POST", handler: webhookNotify });

// The register's read-only feed for the Google Sheet copy (Phase R2).
http.route({ path: "/register-feed", method: "GET", handler: registerFeed });

// Emails (C4): the "stop these emails" link.
// C8: link previews for share links (JSON tags and the picture), asked for by the Cloudflare Worker and by chat apps.
http.route({ pathPrefix: "/og/", method: "GET", handler: og });

// Wrangler Sign (S2): the signing page's requests (sign.wranglerportal.com → POST /ws/<op>).
http.route({ pathPrefix: "/ws/", method: "POST", handler: wsApi });
http.route({ pathPrefix: "/ws/", method: "OPTIONS", handler: wsPreflight });
// S3: the public "is this a real signed copy?" check (a hash in, the document's name out), and the archive's Dropbox.
http.route({ path: "/ws-verify", method: "POST", handler: wsVerify });
http.route({ path: "/ws-verify", method: "OPTIONS", handler: wsPreflight });
http.route({ path: "/ws-dropbox/callback", method: "GET", handler: wsDropboxCallback });

// Wrangler Sign Phase S0 (Oct 26, temporary): which IP headers reach the backend.
http.route({ path: "/ws-s0/ip", method: "GET", handler: wsS0Ip });

// Phase 2 Part B: Stripe Connect events (account changes now; invoices and payments next).
http.route({ path: "/stripe/connect", method: "POST", handler: connectWebhook });
// Phase 3: leads from the website's quote form (off until WEBFLOW_WEBHOOK_SECRET is set).
http.route({ path: "/leads/webflow", method: "POST", handler: webflowLeads });
http.route({ path: "/email/stop", method: "GET", handler: emailStop });
http.route({ path: "/email/stop", method: "POST", handler: emailStop });

export default http;
