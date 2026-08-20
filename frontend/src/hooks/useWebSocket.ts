import { useEffect } from "react";
import { getWebSocketClient, type WebSocketEvent } from "@/lib/websocketClient";

/**
 * Subscribe to WebSocket events of a specific type
 * Returns unsubscribe function automatically called on unmount
 */
export function useWebSocketEvent(
  eventType: string,
  callback: (event: WebSocketEvent) => void,
  enabled = true
): void {
  useEffect(() => {
    if (!enabled) return;

    const client = getWebSocketClient();
    const unsubscribe = client.subscribe(eventType, callback);

    return () => {
      unsubscribe();
    };
  }, [eventType, callback, enabled]);
}

/**
 * Subscribe to multiple event types
 */
export function useWebSocketEvents(
  eventTypes: string[],
  callback: (event: WebSocketEvent) => void,
  enabled = true
): void {
  useEffect(() => {
    if (!enabled) return;

    const client = getWebSocketClient();
    const unsubscribers = eventTypes.map((type) => client.subscribe(type, callback));

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [eventTypes, callback, enabled]);
}
