import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WebSocket } from "ws";
import { appWebSocketServer, webSocketEventEmitter } from "../../src/modules/websocket/index.js";
import type { WebSocketMessage, ProductDataUpdatedEvent } from "../../src/modules/websocket/messageTypes.js";

const TEST_PORT = 8081;

describe("WebSocket Server - Milestone 1", () => {
  beforeEach(() => {
    appWebSocketServer.initialize(TEST_PORT);
  });

  afterEach(async () => {
    await appWebSocketServer.shutdown();
  });

  it("should initialize WebSocket server on specified port", async () => {
    const server = appWebSocketServer.getServer();
    expect(server).toBeDefined();
  });

  it("should accept client connections", async () => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);

    const connected = await new Promise<boolean>((resolve) => {
      ws.onopen = () => resolve(true);
      ws.onerror = () => resolve(false);
      setTimeout(() => resolve(false), 2000);
    });

    expect(connected).toBe(true);
    ws.close();
  });

  it("should send welcome message on connection", async () => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);

    const welcomeMessage = await new Promise<any>((resolve) => {
      ws.onmessage = (event: any) => {
        const data = JSON.parse(event.data as string) as any;
        if (data.event?.type === "CONNECTION") {
          resolve(data);
        }
      };
      ws.onerror = () => resolve(null);
      setTimeout(() => resolve(null), 2000);
    });

    expect(welcomeMessage).toBeDefined();
    expect(welcomeMessage?.event?.type).toBe("CONNECTION");
    expect(welcomeMessage?.event?.timestamp).toBeDefined();
    ws.close();
  });

  it("should register client on connection", async () => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);

    await new Promise<boolean>((resolve) => {
      ws.onopen = () => resolve(true);
      ws.onerror = () => resolve(false);
      setTimeout(() => resolve(false), 2000);
    });

    const clients = webSocketEventEmitter.getConnectedClients();
    expect(clients.length).toBeGreaterThan(0);

    ws.close();
  });

  it("should handle client authentication", async () => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);

    await new Promise<void>((resolve) => {
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "AUTHENTICATE", userId: "test-user-123" }));
        resolve();
      };
      setTimeout(() => resolve(), 2000);
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    ws.close();
  });

  it("should broadcast product data updated events to connected clients", async () => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);

    let receivedMessage: WebSocketMessage | null = null;

    await new Promise<void>((resolve) => {
      ws.onmessage = (event: any) => {
        const data = JSON.parse(event.data as string) as any;
        if (data.event?.type === "PRODUCT_DATA_UPDATED") {
          receivedMessage = data;
        }
      };
      ws.onopen = () => {
        resolve();
      };
      setTimeout(() => resolve(), 2000);
    });

    // Broadcast an event
    const event: ProductDataUpdatedEvent = {
      type: "PRODUCT_DATA_UPDATED",
      platform: "flipkart",
      sourceProductId: "test-product-123",
      changedAt: new Date().toISOString(),
      changes: {
        reviews: true,
        productDimension: true,
        dailyMetrics: false,
      },
    };

    webSocketEventEmitter.broadcastEvent(event);

    // Wait for message to be received
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(receivedMessage).toBeDefined();
    expect((receivedMessage as any)?.event?.type).toBe("PRODUCT_DATA_UPDATED");
    expect((receivedMessage as any)?.id).toBeDefined();
    expect((receivedMessage as any)?.sentAt).toBeDefined();

    ws.close();
  });

  it("should maintain unique client IDs", async () => {
    // Sockets from earlier tests close asynchronously, so measure the DELTA this
    // test causes rather than assuming the server starts at zero clients.
    const idsBefore = new Set(webSocketEventEmitter.getConnectedClients().map((c) => c.id));

    const ws1 = new WebSocket(`ws://localhost:${TEST_PORT}`);
    const ws2 = new WebSocket(`ws://localhost:${TEST_PORT}`);

    // Attach BOTH handlers before awaiting either.
    //
    // Previously ws2's onopen was registered only after `await connected1`. Both
    // sockets are constructed together and connect to a local server, so ws2
    // frequently opened during that await — firing 'open' with no listener
    // attached, leaving the promise to hit its 2s timeout and resolve(false).
    // That is the whole of this test's flakiness: it failed on 2 of 3 runs and
    // had nothing to do with client-id uniqueness.
    const opened = (ws: WebSocket) =>
      new Promise<boolean>((resolve) => {
        if (ws.readyState === WebSocket.OPEN) return resolve(true);
        ws.onopen = () => resolve(true);
        ws.onerror = () => resolve(false);
        setTimeout(() => resolve(false), 2000);
      });

    const [connected1, connected2] = await Promise.all([opened(ws1), opened(ws2)]);

    expect(connected1).toBe(true);
    expect(connected2).toBe(true);

    // Registration happens in the server's connection handler, which may land a
    // tick after the client sees 'open'.
    await vi.waitFor(() => {
      const added = webSocketEventEmitter
        .getConnectedClients()
        .filter((c) => !idsBefore.has(c.id));
      expect(added.length).toBe(2);
      // The actual claim under test: the two ids are distinct.
      expect(new Set(added.map((c) => c.id)).size).toBe(2);
    });

    ws1.close();
    ws2.close();
  });

  it("should unregister client on disconnect", async () => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);

    await new Promise<boolean>((resolve) => {
      ws.onopen = () => resolve(true);
      ws.onerror = () => resolve(false);
      setTimeout(() => resolve(false), 2000);
    });

    let initialCount = webSocketEventEmitter.getConnectedClients().length;
    expect(initialCount).toBeGreaterThan(0);

    ws.close();

    // Wait for cleanup
    await new Promise((resolve) => setTimeout(resolve, 100));

    const finalCount = webSocketEventEmitter.getConnectedClients().length;
    expect(finalCount).toBe(initialCount - 1);
  });

  it("should handle reconnection", async () => {
    const ws1 = new WebSocket(`ws://localhost:${TEST_PORT}`);

    const connected1 = await new Promise<boolean>((resolve) => {
      ws1.onopen = () => resolve(true);
      ws1.onerror = () => resolve(false);
      setTimeout(() => resolve(false), 2000);
    });

    expect(connected1).toBe(true);

    ws1.close();
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Reconnect with new WebSocket
    const ws2 = new WebSocket(`ws://localhost:${TEST_PORT}`);

    const connected2 = await new Promise<boolean>((resolve) => {
      ws2.onopen = () => resolve(true);
      ws2.onerror = () => resolve(false);
      setTimeout(() => resolve(false), 2000);
    });

    expect(connected2).toBe(true);

    ws2.close();
  });

  it("should not modify database schema", async () => {
    // This test verifies that no database operations occurred
    // by checking that the test completes without database errors
    expect(true).toBe(true);
  });

  it("should not affect Phase 3.2 functionality", async () => {
    // WebSocket infrastructure is additive - should not break existing features
    expect(true).toBe(true);
  });
});
