/**
 * Centralized WebSocket client with automatic reconnection and event routing.
 * Single instance for entire application — no duplicate connections.
 */

export interface WebSocketEvent {
  type: "PRODUCT_DATA_UPDATED" | "CONNECTION" | string;
  platform?: "flipkart" | "myntra";
  sourceProductId?: string;
  changedAt?: string;
  changes?: {
    reviews: boolean;
    productDimension: boolean;
    dailyMetrics: boolean;
  };
  timestamp?: string;
}

type EventCallback = (event: WebSocketEvent) => void;

class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private authToken: string | null = null;
  private messageQueue: string[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000; // Start at 1s
  private maxReconnectDelay = 30000; // Cap at 30s
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private eventListeners = new Map<string, Set<EventCallback>>();
  private isIntentionallyClosed = false;

  constructor(url: string) {
    this.url = url;
  }

  /**
   * Connect to WebSocket with authentication
   */
  connect(authToken: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      this.authToken = authToken;
      this.isIntentionallyClosed = false;

      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          console.log("[WebSocket] Connected");
          this.reconnectAttempts = 0;
          this.reconnectDelay = 1000;
          this.authenticate();
          this.startHeartbeat();
          this.flushMessageQueue();
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.event) {
              this.handleEvent(msg.event);
            }
          } catch (err) {
            console.error("[WebSocket] Failed to parse message:", err);
          }
        };

        this.ws.onclose = () => {
          console.log("[WebSocket] Disconnected");
          this.stopHeartbeat();
          if (!this.isIntentionallyClosed) {
            this.scheduleReconnect();
          }
        };

        this.ws.onerror = (error) => {
          console.error("[WebSocket] Error:", error);
          reject(error);
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Disconnect intentionally
   */
  disconnect(): void {
    this.isIntentionallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Send authentication message to server
   */
  private authenticate(): void {
    if (this.ws?.readyState === WebSocket.OPEN && this.authToken) {
      this.send({
        type: "AUTHENTICATE",
        token: this.authToken,
      });
    }
  }

  /**
   * Send message to server (queue if not connected)
   */
  private send(data: unknown): void {
    const msg = JSON.stringify(data);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(msg);
    } else {
      this.messageQueue.push(msg);
    }
  }

  /**
   * Flush queued messages on reconnect
   */
  private flushMessageQueue(): void {
    while (this.messageQueue.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
      const msg = this.messageQueue.shift();
      if (msg) this.ws.send(msg);
    }
  }

  /**
   * Schedule automatic reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("[WebSocket] Max reconnection attempts reached");
      return;
    }

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    this.reconnectAttempts++;
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.maxReconnectDelay
    );

    console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      if (this.authToken && !this.isIntentionallyClosed) {
        this.connect(this.authToken).catch((err) => {
          console.error("[WebSocket] Reconnect failed:", err);
        });
      }
    }, delay);
  }

  /**
   * Start heartbeat to detect stale connections
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({ type: "PING" });
      }
    }, 30000); // 30 second heartbeat
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Route event to registered listeners
   */
  private handleEvent(event: WebSocketEvent): void {
    // Notify all listeners for this event type
    const listeners = this.eventListeners.get(event.type);
    if (listeners) {
      listeners.forEach((callback) => callback(event));
    }

    // Notify wildcard listeners
    const wildcardListeners = this.eventListeners.get("*");
    if (wildcardListeners) {
      wildcardListeners.forEach((callback) => callback(event));
    }
  }

  /**
   * Subscribe to an event type
   */
  subscribe(eventType: string, callback: EventCallback): () => void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, new Set());
    }
    this.eventListeners.get(eventType)!.add(callback);

    // Return unsubscribe function
    return () => {
      const listeners = this.eventListeners.get(eventType);
      if (listeners) {
        listeners.delete(callback);
      }
    };
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Get connection status
   */
  getStatus(): "connected" | "connecting" | "disconnected" {
    if (!this.ws) return "disconnected";
    if (this.ws.readyState === WebSocket.OPEN) return "connected";
    if (this.ws.readyState === WebSocket.CONNECTING) return "connecting";
    return "disconnected";
  }
}

// Singleton instance
let instance: WebSocketClient | null = null;

export function getWebSocketClient(url = "ws://localhost:8080"): WebSocketClient {
  if (!instance) {
    instance = new WebSocketClient(url);
  }
  return instance;
}

export function resetWebSocketClient(): void {
  if (instance) {
    instance.disconnect();
    instance = null;
  }
}
