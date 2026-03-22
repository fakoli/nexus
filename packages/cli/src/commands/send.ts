import { Command } from "commander";
import { getAllConfig, runMigrations, createLogger } from "@nexus/core";
import WebSocket from "ws";

const log = createLogger("cli:send");

export const sendCommand = new Command("send")
  .description("Send a message to the gateway")
  .requiredOption("-m, --message <text>", "message text")
  .option("-s, --session <id>", "session ID")
  .option("-t, --token <token>", "auth token (overrides config)")
  .action(async (opts: { message: string; session?: string; token?: string }) => {
    runMigrations();
    const config = getAllConfig();

    const host = config.gateway.bind === "loopback" ? "127.0.0.1" : "0.0.0.0";
    const url = `ws://${host}:${config.gateway.port}/ws`;

    log.info({ url }, "Connecting to gateway");
    const ws = new WebSocket(url);

    // The Nexus gateway protocol requires ConnectParams as the first message
    // after the WebSocket upgrade.  Only after receiving HelloOk may the client
    // send RPC RequestFrames.  Skipping this step causes the server to close
    // the connection with 4401 AUTH_FAILED.
    const connectParams: Record<string, unknown> = {};
    const token = opts.token ?? (config.security as Record<string, unknown>).gatewayToken as string | undefined;
    if (token) connectParams.token = token;
    connectParams.client = { name: "nexus-cli", version: "0.1.0", platform: process.platform };

    // Track whether we have completed the handshake so we can distinguish
    // the HelloOk response from subsequent RPC responses.
    let handshakeDone = false;

    const rpcRequest = {
      id: "send-1",
      method: "chat.send",
      params: {
        // chat.send requires a sessionId; fall back to the session from config
        // or omit (server will return SESSION_NOT_FOUND with a clear message).
        ...(opts.session ? { sessionId: opts.session } : {}),
        content: opts.message,
        role: "user",
      },
    };

    ws.on("open", () => {
      log.info("Connected, performing handshake...");
      ws.send(JSON.stringify(connectParams));
    });

    ws.on("message", (data: WebSocket.Data) => {
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(data.toString()) as Record<string, unknown>;
      } catch {
        console.error("Received invalid JSON from gateway");
        ws.close();
        return;
      }

      if (!handshakeDone) {
        // Expect HelloOk: { proto, server, session }
        if (typeof frame.proto === "number" && frame.session) {
          handshakeDone = true;
          const session = frame.session as { id: string };
          log.info({ sessionId: session.id }, "Handshake complete, sending request");
          // If no --session was specified, use the server-assigned session.
          if (!opts.session) {
            rpcRequest.params = { ...rpcRequest.params, sessionId: session.id };
          }
          ws.send(JSON.stringify(rpcRequest));
        } else {
          // Server sent an error frame instead of HelloOk (e.g. auth failure).
          const errObj = frame.error as { code?: string; message?: string } | undefined;
          console.error(
            "Gateway authentication failed:",
            errObj?.message ?? JSON.stringify(frame),
          );
          ws.close();
        }
        return;
      }

      // RPC response frame: { id, ok, payload?, error? }
      const errObj = frame.error as { code?: string; message?: string } | undefined;
      if (frame.ok === false && errObj) {
        console.error(`Error [${errObj.code ?? "UNKNOWN"}]: ${errObj.message ?? JSON.stringify(errObj)}`);
      } else {
        const payload = frame.payload as { messageId?: string } | undefined;
        console.log(
          payload ? JSON.stringify(payload, null, 2) : JSON.stringify(frame, null, 2),
        );
      }
      ws.close();
    });

    ws.on("error", (err: Error) => {
      console.error("WebSocket error:", err.message);
      process.exit(1);
    });

    ws.on("close", () => {
      process.exit(0);
    });
  });
