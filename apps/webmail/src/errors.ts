import { createSignal } from "solid-js";

export interface GlobalError {
  message: string;
  isAuth?: boolean;
}

const [globalError, setGlobalErrorSignal] = createSignal<GlobalError | null>(null);
let autoDismissTimer: ReturnType<typeof setTimeout> | null = null;

export function getGlobalError(): GlobalError | null {
  return globalError();
}

export function setGlobalError(message: string | null, isAuth: boolean = false): void {
  if (autoDismissTimer) {
    clearTimeout(autoDismissTimer);
    autoDismissTimer = null;
  }

  if (!message) {
    setGlobalErrorSignal(null);
    return;
  }

  setGlobalErrorSignal({ message, isAuth });

  // Auto-dismiss after 8 seconds for transient errors (unless auth error)
  if (!isAuth) {
    autoDismissTimer = setTimeout(() => {
      setGlobalErrorSignal(null);
      autoDismissTimer = null;
    }, 8000);
  }
}

export function clearGlobalError(): void {
  if (autoDismissTimer) {
    clearTimeout(autoDismissTimer);
    autoDismissTimer = null;
  }
  setGlobalErrorSignal(null);
}
