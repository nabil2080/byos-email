/* @refresh reload */
import { render } from 'solid-js/web'
import { ErrorBoundary } from 'solid-js'
import './index.css'
import App from './App.tsx'

const root = document.getElementById('root')

render(
  () => (
    <ErrorBoundary
      fallback={(err, reset) => (
        <div class="min-h-screen bg-[#F0EEE9] flex items-center justify-center p-4 font-sans select-none">
          <div class="w-full max-w-md bg-white rounded-2xl border border-[#E2DFD8] shadow-lg p-6 text-center space-y-4">
            <div class="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto text-lg font-bold">
              !
            </div>
            <div>
              <h1 class="text-base font-bold text-[#1A1B1E]">Support System Connection Offline</h1>
              <p class="text-xs text-[#6E7075] mt-1">
                {err?.message || "Backend administrative database connection is not reachable."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                reset();
                window.location.reload();
              }}
              class="px-4 py-2 bg-[#9E725F] hover:bg-[#8A6352] text-white text-xs font-semibold rounded-xl shadow-xs cursor-pointer transition-colors"
            >
              Reload Application
            </button>
          </div>
        </div>
      )}
    >
      <App />
    </ErrorBoundary>
  ),
  root!
);
