// WebSocket event types and contracts

export type Platform = "flipkart" | "myntra";

export interface ProductDataUpdatedEvent {
  type: "PRODUCT_DATA_UPDATED";
  platform: Platform;
  sourceProductId: string;
  changedAt: string; // ISO8601 timestamp
  changes: {
    reviews: boolean;
    productDimension: boolean;
    dailyMetrics: boolean;
  };
}

export interface ConnectionEvent {
  type: "CONNECTION" | "RECONNECT" | "DISCONNECT";
  timestamp: string; // ISO8601 timestamp
}

export type WebSocketEvent = ProductDataUpdatedEvent | ConnectionEvent;

export interface WebSocketMessage {
  id: string; // unique message ID for idempotency
  event: WebSocketEvent;
  sentAt: string; // ISO8601 timestamp
}
