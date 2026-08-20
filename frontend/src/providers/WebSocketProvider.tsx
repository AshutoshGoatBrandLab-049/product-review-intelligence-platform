import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "./AuthProvider";
import { getWebSocketClient } from "@/lib/websocketClient";

interface WebSocketContextType {
  isConnected: boolean;
  status: "connected" | "connecting" | "disconnected";
}

const WebSocketContext = createContext<WebSocketContextType | undefined>(undefined);

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const { isConfigured } = useAuth();
  const [state, setState] = useState<WebSocketContextType>({
    isConnected: false,
    status: "disconnected",
  });

  useEffect(() => {
    if (!isConfigured) return;

    const client = getWebSocketClient();
    const token = localStorage.getItem("authToken") || "dev-token-placeholder";

    if (!token) return;

    // Connect WebSocket with auth token
    client.connect(token).then(() => {
      setState({ isConnected: true, status: "connected" });
    }).catch((err) => {
      console.error("[WebSocketProvider] Connection failed:", err);
      setState({ isConnected: false, status: "disconnected" });
    });

    // Listen for status changes
    const checkStatus = setInterval(() => {
      const status = client.getStatus();
      const isConnected = status === "connected";
      setState({ isConnected, status });
    }, 1000);

    return () => {
      clearInterval(checkStatus);
      // Don't disconnect on unmount — keep connection alive for next page
    };
  }, [isConfigured]);

  return (
    <WebSocketContext.Provider value={state}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocketStatus(): WebSocketContextType {
  const ctx = useContext(WebSocketContext);
  if (!ctx) throw new Error("useWebSocketStatus must be used within WebSocketProvider");
  return ctx;
}
