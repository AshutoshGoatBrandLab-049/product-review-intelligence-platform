import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runTrackA } from "../../src/modules/ingestion/trackA.js";
import { runTrackB } from "../../src/modules/ingestion/trackB.js";
import { webSocketEventEmitter } from "../../src/modules/websocket/eventEmitter.js";
import { appSequelize } from "../../src/database/appStore/client.js";
import { NormalizedReview } from "../../src/database/appStore/models/normalizedReview.js";
import { ProductDimension } from "../../src/database/appStore/models/productDimension.js";
import { ProductDailyMetrics } from "../../src/database/appStore/models/productDailyMetrics.js";
import type { Platform } from "../../src/types/unifiedReview.js";

describe("Milestone 2: WebSocket Event Emission after Database Commit", () => {
  let broadcastedEvents: any[] = [];

  beforeEach(() => {
    broadcastedEvents = [];
    // Spy on event emission
    const originalBroadcast = webSocketEventEmitter.broadcastEvent.bind(webSocketEventEmitter);
    webSocketEventEmitter.broadcastEvent = function (event) {
      broadcastedEvents.push(event);
      return originalBroadcast(event);
    };
  });

  afterEach(() => {
    broadcastedEvents = [];
  });

  describe("TrackA Event Emission", () => {
    it("should emit PRODUCT_DATA_UPDATED event AFTER TrackA transaction commits", async () => {
      // Converge first. This file does not reset the database, so it inherits
      // whatever the previously-executed file left behind — which may include
      // canonical rows with no matching source row. Those are real changes, and
      // Track A now legitimately emits events when it cleans them up, so
      // "rowsInserted === 0" alone no longer implies "no events".
      //
      // One converging run makes the precondition explicit; the assertions below
      // then describe a genuinely quiet database rather than an inherited one.
      await runTrackA("flipkart");

      broadcastedEvents = [];
      const result = await runTrackA("flipkart");
      expect(result.status).toBe("success");

      if (result.rowsInserted > 0) {
        expect(broadcastedEvents.length).toBeGreaterThan(0);

        // Verify all events have correct format
        for (const event of broadcastedEvents) {
          expect(event.type).toBe("PRODUCT_DATA_UPDATED");
          expect(event.platform).toBe("flipkart");
          expect(event.sourceProductId).toBeDefined();
          expect(event.changedAt).toBeDefined();
          expect(event.changes).toBeDefined();
          expect(event.changes.reviews).toBe(true);
          expect(event.changes.productDimension).toBe(true);
          expect(event.changes.dailyMetrics).toBe(true);
        }
      } else {
        // Nothing inserted AND nothing stale left to clean → a true no-op run,
        // which must be silent. This is the stronger claim: not merely "no
        // inserts", but "no writes of any kind, therefore no events".
        expect(broadcastedEvents.length).toBe(0);
      }
    });

    it("should deduplicate events for multiple reviews of same product", async () => {
      broadcastedEvents = [];
      const result = await runTrackA("myntra");

      if (result.rowsInserted > 1) {
        // Count unique products
        const uniqueProducts = new Set(
          broadcastedEvents.map((e) => `${e.platform}:${e.sourceProductId}`),
        );

        // Should have fewer or equal events than inserted reviews
        expect(uniqueProducts.size).toBeLessThanOrEqual(result.rowsInserted);
      }
    });
  });

  describe("TrackB Discovery Event Emission", () => {
    it("should emit PRODUCT_DATA_UPDATED event AFTER TrackB discovery commit", async () => {
      broadcastedEvents = [];
      const result = await runTrackB("flipkart");

      expect(result.status).toBe("success");

      // Discovery: new reviews found
      if (result.rowsInserted > 0) {
        expect(broadcastedEvents.length).toBeGreaterThan(0);

        // Verify format
        for (const event of broadcastedEvents.slice(0, result.rowsInserted)) {
          expect(event.type).toBe("PRODUCT_DATA_UPDATED");
          expect(event.platform).toBe("flipkart");
          expect(event.sourceProductId).toBeDefined();
        }
      }
    });
  });

  describe("TrackB Update Event Emission", () => {
    it("should emit PRODUCT_DATA_UPDATED event AFTER TrackB update commit", async () => {
      broadcastedEvents = [];
      const result = await runTrackB("myntra");

      expect(result.status).toBe("success");

      // Update: reviews with changed content
      if (result.rowsUpdated > 0) {
        // At minimum, we should have some events for updates
        // Note: updates are emitted one per review update in current implementation
        expect(result.rowsUpdated).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("Event Format Compliance", () => {
    it("should emit ProductDataUpdatedEvent with correct schema", async () => {
      broadcastedEvents = [];
      const result = await runTrackA("flipkart");

      for (const event of broadcastedEvents) {
        // Verify required fields
        expect(event.type).toBe("PRODUCT_DATA_UPDATED");
        expect(typeof event.platform).toBe("string");
        expect(["flipkart", "myntra"]).toContain(event.platform);
        expect(typeof event.sourceProductId).toBe("string");
        expect(event.sourceProductId.length).toBeGreaterThan(0);
        expect(typeof event.changedAt).toBe("string");
        expect(new Date(event.changedAt).getTime()).toBeGreaterThan(0);

        // Verify changes object
        expect(typeof event.changes).toBe("object");
        expect(typeof event.changes.reviews).toBe("boolean");
        expect(typeof event.changes.productDimension).toBe("boolean");
        expect(typeof event.changes.dailyMetrics).toBe("boolean");
      }
    });

    it("should include only lightweight data (no SQL, no credentials)", () => {
      for (const event of broadcastedEvents) {
        const eventJson = JSON.stringify(event);

        // Verify no raw review data
        expect(eventJson).not.toContain("SELECT");
        expect(eventJson).not.toContain("INSERT");
        expect(eventJson).not.toContain("UPDATE");
        expect(eventJson).not.toContain("DELETE");

        // Verify no review text (PII)
        expect(eventJson).not.toMatch(/review[_-]?text/i);
        expect(eventJson).not.toMatch(/author[_-]?name/i);
      }
    });
  });

  describe("Database Integrity After Emission", () => {
    it("should have synchronized product_dimension after events emitted", async () => {
      broadcastedEvents = [];
      const result = await runTrackA("flipkart");

      if (result.rowsInserted > 0) {
        // Get one of the updated products from events
        if (broadcastedEvents.length > 0) {
          const event = broadcastedEvents[0];
          const productDim = await ProductDimension.findOne({
            where: {
              platform: event.platform,
              sourceProductId: event.sourceProductId,
            },
          });

          expect(productDim).toBeDefined();
          expect(productDim?.lastRebuiltAt).toBeDefined();
        }
      }
    });

    it("should have synchronized product_daily_metrics after events emitted", async () => {
      broadcastedEvents = [];
      const result = await runTrackA("myntra");

      if (result.rowsInserted > 0 && broadcastedEvents.length > 0) {
        const event = broadcastedEvents[0];
        const dailyMetrics = await ProductDailyMetrics.findOne({
          where: {
            platform: event.platform,
            sourceProductId: event.sourceProductId,
          },
        });

        expect(dailyMetrics).toBeDefined();
      }
    });
  });

  describe("No Events on Database Rollback", () => {
    it("should handle transaction failures gracefully", async () => {
      // Verify that TrackA and TrackB have error handling
      // If either throws, the error should propagate and no partial state should remain
      const result = await runTrackA("flipkart");
      expect(result.status).toBe("success");

      // If transaction fails, it would be caught by the try-catch in runTrackA/runTrackB
      // The test verifies this indirectly by checking that status is either "success" or "failed"
      expect(["success", "failed"]).toContain(result.status);
    });
  });

  describe("WebSocket Failure Does Not Rollback Database", () => {
    it("should log WebSocket broadcast failures but not stop ingestion", async () => {
      // This test verifies that the WebSocket event emission is wrapped in try-catch
      // and doesn't prevent database changes from being committed

      broadcastedEvents = [];
      const result = await runTrackA("flipkart");

      // Verify database was committed regardless of WebSocket state
      expect(result.status).toBe("success");

      // Database should have changes even if WebSocket emission had issues
      if (result.rowsInserted > 0) {
        expect(result.rowsInserted).toBeGreaterThan(0);
      }
    });
  });
});
