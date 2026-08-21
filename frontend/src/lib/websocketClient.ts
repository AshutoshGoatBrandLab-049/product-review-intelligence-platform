/**
 * Centralized WebSocket client with automatic reconnection and event routing.
 * Single instance for entire application — no duplicate connections.
 */

export interface WebSocketEvent {
  type: "PRODUCT_DATA_UPDATED" | "CONNECTION" | "CONNECTION_RESTORED" | string;
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
  private reconnectDelay = 1000; // Start at 1s
  private maxReconnectDelay = 30000; // Cap at 30s
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private eventListeners = new Map<string, Set<EventCallback>>();
  private isIntentionallyClosed = false;
  /** In-flight connect, so concurrent callers share one socket instead of racing. */
  private connecting: Promise<void> | null = null;
  /** Recently seen message ids — the server may redeliver, and handlers must be idempotent. */
  private seenMessageIds = new Set<string>();
  private seenOrder: string[] = [];

  constructor(url: string) {
    this.url = url;
  }

  /**
   * Connect to WebSocket with authentication.
   *
   * Guards against CONNECTING as well as OPEN. Previously only OPEN was checked,
   * so two near-simultaneous callers each constructed a socket; the second
   * overwrote `this.ws` while the first stayed open, and every broadcast was
   * delivered twice (observed: 2 connections to :8080 from a single page).
   */
  connect(authToken: string): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.connecting) return this.connecting;

    this.connecting = new Promise<void>((resolve, reject) => {
      this.authToken = authToken;
      this.isIntentionallyClosed = false;

      try {
        // Discard any half-open socket before replacing it, so it cannot linger
        // and keep receiving frames.
        if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
          try {
            this.ws.onclose = null;
            this.ws.close();
          } catch {
            /* already closing */
          }
        }
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          console.log("[WebSocket] Connected");
          const wasReconnect = this.reconnectAttempts > 0;
          this.reconnectAttempts = 0;
          this.reconnectDelay = 1000;
          this.authenticate();
          this.startHeartbeat();
          this.flushMessageQueue();

          /**
           * A WebSocket is not a durable queue. Any PRODUCT_DATA_UPDATED emitted
           * while this tab was disconnected is gone — there is no replay — so the
           * database can be fully converged while the tab still shows stale data
           * forever (observed: 9 rows synced during a ~50s outage, UI never
           * caught up).
           *
           * Reconnecting therefore means "I may have missed something". Consumers
           * subscribe to this and resync, which is what turns reconnection into
           * actual recovery rather than just a live socket.
           */
          if (wasReconnect) {
            console.log("[WebSocket] Reconnected — requesting resync");
            this.handleEvent({ type: "CONNECTION_RESTORED", timestamp: new Date().toISOString() });
          }
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            // Drop redeliveries. One logical source change can be re-broadcast
            // (reconnect, retry, or a second instance), and handlers refetch —
            // so a duplicate is wasted work, not a correctness problem, but it
            // is cheap to suppress here rather than in every consumer.
            if (msg.id && this.hasSeen(msg.id)) return;
            if (msg.event) {
              this.handleEvent(msg.event);
            }
          } catch (err) {
            console.error("[WebSocket] Failed to parse message:", err);
          }
        };

        this.ws.onclose = () => {
          console.log("[WebSocket] Disconnected");
          this.connecting = null;
          this.stopHeartbeat();
          if (!this.isIntentionallyClosed) {
            this.scheduleReconnect();
          }
        };

        this.ws.onerror = (error) => {
          console.error("[WebSocket] Error:", error);
          this.connecting = null;
          reject(error);
        };
      } catch (err) {
        this.connecting = null;
        reject(err);
      }
    }).finally(() => {
      this.connecting = null;
    });

    return this.connecting;
  }

  /** Bounded LRU of message ids; returns true if this id was already handled. */
  private hasSeen(id: string): boolean {
    if (this.seenMessageIds.has(id)) return true;
    this.seenMessageIds.add(id);
    this.seenOrder.push(id);
    if (this.seenOrder.length > 500) {
      const evicted = this.seenOrder.shift();
      if (evicted) this.seenMessageIds.delete(evicted);
    }
    return false;
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
    // Retry FOREVER, with the delay capped at maxReconnectDelay.
    //
    // This used to stop permanently after 10 attempts. A backend restart that
    // took longer than the ~30s those attempts covered left the tab silently
    // disconnected for the rest of its life: the database kept synchronizing,
    // events kept being emitted, and that browser never heard another one — with
    // no error shown and no way back except a manual page reload, which is
    // precisely what this feature exists to avoid. A capped-backoff retry costs
    // one connection attempt every 30s while the server is down.
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    this.reconnectAttempts++;
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.maxReconnectDelay
    );

    console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

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
