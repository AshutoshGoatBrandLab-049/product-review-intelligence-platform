import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { webSocketEventEmitter } from "./eventEmitter.js";
import type { WebSocketMessage, ConnectionEvent } from "./messageTypes.js";
import { logger } from "../../shared/logger.js";

interface AuthenticatedWebSocket extends WebSocket {
  clientId: string;
  userId?: string;
  isAlive: boolean;
}

export class AppWebSocketServer {
  private wss: WebSocketServer | null = null;
  private clients = new Map<string, AuthenticatedWebSocket>();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  /**
   * Initialize WebSocket server
   * Port should be provided via configuration
   */
  initialize(port: number): void {
    try {
      this.wss = new WebSocketServer({ port });

      this.wss.on("connection", (ws: WebSocket) => {
        this.handleNewConnection(ws as AuthenticatedWebSocket);
      });

      // Start heartbeat to detect dead connections
      this.startHeartbeat();

      logger.info({ port }, "WebSocket server initialized");
    } catch (err) {
      logger.error({ port, error: (err as Error).message }, "Failed to initialize WebSocket server");
      throw err;
    }
  }

  /**
   * Handle new client connection
   */
  private handleNewConnection(ws: AuthenticatedWebSocket): void {
    const clientId = randomUUID();
    ws.clientId = clientId;
    ws.isAlive = true;

    this.clients.set(clientId, ws);
    webSocketEventEmitter.registerClient(clientId);

    logger.debug({ clientId }, "New WebSocket client connected");

    // Handle incoming messages (heartbeat, authentication, etc.)
    ws.on("message", (data: Buffer) => {
      this.handleClientMessage(clientId, data);
    });

    // Handle client disconnect
    ws.on("close", () => {
      this.handleClientDisconnect(clientId);
    });

    // Handle errors
    ws.on("error", (error: Error) => {
      logger.error({ clientId, error: error.message }, "WebSocket client error");
    });

    // Handle pong (from heartbeat ping)
    ws.on("pong", () => {
      const client = this.clients.get(clientId);
      if (client) {
        client.isAlive = true;
        webSocketEventEmitter.markClientAlive(clientId);
      }
    });

    // Send welcome message
    const connectionEvent: ConnectionEvent = {
      type: "CONNECTION",
      timestamp: new Date().toISOString(),
    };
    this.sendMessageToClient(clientId, {
      id: randomUUID(),
      event: connectionEvent,
      sentAt: new Date().toISOString(),
    });
  }

  /**
   * Handle message from client
   */
  private handleClientMessage(clientId: string, data: Buffer): void {
    try {
      const message = JSON.parse(data.toString());

      // Handle authentication message
      if (message.type === "AUTHENTICATE") {
        const client = this.clients.get(clientId);
        if (client) {
          client.userId = message.userId;
          webSocketEventEmitter.registerClient(clientId, message.userId);
          logger.debug({ clientId, userId: message.userId }, "Client authenticated");
        }
      }
    } catch (err) {
      logger.error({ clientId, error: (err as Error).message }, "Failed to parse client message");
    }
  }

  /**
   * Handle client disconnect
   */
  private handleClientDisconnect(clientId: string): void {
    this.clients.delete(clientId);
    webSocketEventEmitter.unregisterClient(clientId);
    logger.debug({ clientId }, "Client disconnected");
  }

  /**
   * Send WebSocketMessage to specific client
   */
  private sendMessageToClient(clientId: string, message: WebSocketMessage): void {
    const client = this.clients.get(clientId);
    if (client && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  }

  /**
   * Send raw data to specific client
   */
  private sendToClient(clientId: string, data: object): void {
    const client = this.clients.get(clientId);
    if (client && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  }

  /**
   * Broadcast message to all connected clients
   * Called by eventEmitter when an event occurs
   */
  broadcastToClients(message: WebSocketMessage): void {
    const payload = JSON.stringify(message);
    let successCount = 0;
    let failureCount = 0;

    logger.info(
      {
        messageId: message.id,
        eventType: (message.event as any)?.type,
        totalClients: this.clients.size,
        openClients: Array.from(this.clients.values()).filter(c => c.readyState === WebSocket.OPEN).length
      },
      "[PHASE3-DEBUG] broadcastToClients called"
    );

    for (const [clientId, client] of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(payload);
          successCount++;
          logger.info(
            { clientId },
            `[PHASE3-DEBUG] Sent message to client`
          );
        } catch (err) {
          logger.error(
            { clientId, error: (err as Error).message },
            "Failed to send message to client"
          );
          failureCount++;
        }
      }
    }

    logger.info(
      { successCount, failureCount },
      "[PHASE3-DEBUG] Broadcast complete"
    );

    if (failureCount > 0) {
      logger.warn(
        { successCount, failureCount },
        "Some WebSocket clients failed to receive broadcast"
      );
    }
  }

  /**
   * Start heartbeat to detect dead connections
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      for (const [clientId, client] of this.clients) {
        if (client.isAlive === false) {
          client.terminate();
          this.clients.delete(clientId);
          webSocketEventEmitter.unregisterClient(clientId);
          return;
        }

        client.isAlive = false;
        client.ping();
      }
    }, 30000); // 30 second heartbeat
  }

  /**
   * Shutdown WebSocket server
   */
  async shutdown(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    if (this.wss) {
      this.wss.clients.forEach((client) => {
        client.terminate();
      });
      // @ts-ignore - close() signature mismatch with ws types
      this.wss.close();
      logger.info({}, "WebSocket server shut down");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /**
   * Get server instance
   */
  getServer(): WebSocketServer | null {
    return this.wss;
  }

  /**
   * Get client count (for monitoring)
   */
  getClientCount(): number {
    return Array.from(this.clients.values()).filter((c) => c.isAlive).length;
  }
}

// Singleton instance
export const appWebSocketServer = new AppWebSocketServer();

// Listen for broadcast events and send to all clients
webSocketEventEmitter.onBroadcast((message: WebSocketMessage) => {
  appWebSocketServer.broadcastToClients(message);
});
