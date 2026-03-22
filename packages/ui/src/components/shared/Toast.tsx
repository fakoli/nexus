import { Component, For, createSignal, onCleanup } from "solid-js";

export type ToastType = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

const BG: Record<ToastType, string> = {
  success: "#1a3a1a",
  error: "#3a1a1a",
  info: "#1a2a3a",
};

const BORDER: Record<ToastType, string> = {
  success: "#4caf50",
  error: "#f44336",
  info: "#4a9eff",
};

const [toasts, setToasts] = createSignal<ToastItem[]>([]);
let nextId = 0;

export function showToast(message: string, type: ToastType = "info"): void {
  const id = nextId++;
  setToasts((prev) => [...prev, { id, message, type }]);
  const timer = setTimeout(() => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, 3000);
  // Store timer reference on the item isn't needed; closure captures id
  void timer;
}

const Toast: Component = () => {
  onCleanup(() => setToasts([]));

  return (
    <div style={{
      position: "fixed",
      bottom: "20px",
      right: "20px",
      display: "flex",
      "flex-direction": "column",
      gap: "8px",
      "z-index": "9999",
      "pointer-events": "none",
    }}>
      <For each={toasts()}>
        {(toast) => (
          <div style={{
            background: BG[toast.type],
            border: `1px solid ${BORDER[toast.type]}`,
            "border-radius": "8px",
            color: "#e0e0e0",
            "font-family": "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            "font-size": "13px",
            "line-height": "1.4",
            padding: "10px 16px",
            "box-shadow": "0 4px 16px rgba(0,0,0,0.5)",
            "max-width": "320px",
            "pointer-events": "auto",
            animation: "toast-in 0.2s ease",
          }}>
            {toast.message}
          </div>
        )}
      </For>
      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

export default Toast;
