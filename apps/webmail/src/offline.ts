import { createSignal, createMemo } from "solid-js";

export type NetworkState = "online" | "offline" | "reconnecting" | "back_online";

const getInitialState = (): NetworkState => {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "offline";
  }
  return "online";
};

const [networkState, setNetworkState] = createSignal<NetworkState>(getInitialState());
const isOffline = () => networkState() === "offline";
const isReconnecting = () => networkState() === "reconnecting";
const isBackOnline = () => networkState() === "back_online";

type ReconnectHandler = () => Promise<void> | void;
const reconnectHandlers = new Set<ReconnectHandler>();

export function onNetworkReconnect(handler: ReconnectHandler): () => void {
  reconnectHandlers.add(handler);
  return () => {
    reconnectHandlers.delete(handler);
  };
}

let initialized = false;

export function initNetworkListeners(): void {
  if (initialized || typeof window === "undefined") {
    return;
  }
  initialized = true;

  window.addEventListener("offline", () => {
    setNetworkState("offline");
  });

  window.addEventListener("online", async () => {
    setNetworkState("reconnecting");
    for (const handler of Array.from(reconnectHandlers)) {
      try {
        await handler();
      } catch (err) {
        console.error("[offline] Reconnect handler error:", err);
      }
    }
    setNetworkState("back_online");
    setTimeout(() => {
      if (networkState() === "back_online") {
        setNetworkState("online");
      }
    }, 3500);
  });
}

export function useNetworkState() {
  return {
    networkState,
    setNetworkState,
    isOffline,
    isReconnecting,
    isBackOnline,
  };
}

export const SHELL_CACHE = "byos-shell-v1";
export const RUNTIME_CACHE = "byos-runtime-v1";

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | undefined> {
  if (typeof window !== "undefined" && "serviceWorker" in navigator) {
    try {
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      return reg;
    } catch (err) {
      console.warn("[sw] Service worker registration failed:", err);
    }
  }
  return undefined;
}

export async function clearServiceWorkerCaches(): Promise<void> {
  if (typeof caches !== "undefined") {
    await Promise.all([
      caches.delete(SHELL_CACHE),
      caches.delete(RUNTIME_CACHE),
    ]);
  }
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ action: "CLEAR_CACHES" });
  }
}

export { networkState, setNetworkState, isOffline, isReconnecting, isBackOnline };
