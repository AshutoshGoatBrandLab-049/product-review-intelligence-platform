import { EventEmitter } from "events";
import type { WebSocketEvent, WebSocketMessage } from "./messageTypes.js";
import { randomUUID } from "node:crypto";
import { logger } from "../../shared/logger.js";

interface WebSocketClient {
  id: string;
  userId?: string;
  isAlive: boolean;
}

class WebSocketEventEmitter {
  private emitter = new EventEmitter();
  private connectedClients = new Map<string, WebSocketClient>();

  /**
   * Register a connected client
   */
  registerClient(clientId: string, userId?: string): void {
    this.connectedClients.set(clientId, {
      id: clientId,
      userId,
      isAlive: true,
    });
    logger.debug({ clientId, userId }, "WebSocket client registered");
  }

  /**
   * Unregister a disconnected client
   */
  unregisterClient(clientId: string): void {
    this.connectedClients.delete(clientId);
    logger.debug({ clientId }, "WebSocket client unregistered");
  }

  /**
   * Mark client as alive (for heartbeat/ping-pong)
   */
  markClientAlive(clientId: string): void {
    const client = this.connectedClients.get(clientId);
    if (client) {
      client.isAlive = true;
    }
  }

  /**
   * Get all connected clients (for broadcasting)
   */
  getConnectedClients(): WebSocketClient[] {
    return Array.from(this.connectedClients.values()).filter((c) => c.isAlive);
  }

  /**
   * Emit event to all connected clients
   * CRITICAL: Only call this AFTER successful database transaction commit
   */
  broadcastEvent(event: WebSocketEvent): void {
    const message: WebSocketMessage = {
      id: randomUUID(),
      event,
      sentAt: new Date().toISOString(),
    };

    logger.debug(
      { messageId: message.id, eventType: event.type, clientCount: this.connectedClients.size },
      "Broadcasting WebSocket event"
    );

    // Emit to internal listeners (connected clients)
    this.emitter.emit("message", message);
  }

  /**
   * Listen for broadcast messages
   * Used by WebSocket server to send to clients
   */
  onBroadcast(callback: (message: WebSocketMessage) => void): void {
    this.emitter.on("message", callback);
  }

  /**
   * Remove broadcast listener
   */
  offBroadcast(callback: (message: WebSocketMessage) => void): void {
    this.emitter.off("message", callback);
  }
}

// Singleton instance
export const webSocketEventEmitter = new WebSocketEventEmitter();
