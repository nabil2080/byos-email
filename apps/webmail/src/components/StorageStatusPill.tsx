import { Component, createSignal, Show } from "solid-js";

export type StorageSyncState = "synced" | "syncing" | "degraded";

interface StorageStatusPillProps {
  isUnlocked: boolean;
  syncState?: StorageSyncState;
  storageError?: string | null;
}

export const StorageStatusPill: Component<StorageStatusPillProps> = (props) => {
  const [popoverOpen, setPopoverOpen] = createSignal(false);

  const statusInfo = () => {
    if (props.storageError) {
      return {
        state: "degraded",
        dotColor: "bg-rose-500",
        pillBg: "bg-rose-50 border-rose-200 text-rose-800",
        label: "Storage Degraded",
        details: props.storageError,
      };
    }
    return {
      state: "synced",
      dotColor: "bg-emerald-500",
      pillBg: "bg-emerald-50 border-emerald-200 text-emerald-800",
      label: "Synced to S3",
      details: "Connected to customer storage bucket. All data encrypted before transfer.",
    };
  };

  return (
    <div class="relative">
      {/* Flat Borderless Pill Trigger */}
      <button
        type="button"
        onClick={() => setPopoverOpen(!popoverOpen())}
        class="w-full px-2 py-1.5 rounded-lg flex items-center justify-between transition text-[11px] text-[#5E6063] hover:text-[#2B2C2D] hover:bg-[#E8E5DF]/60 select-none cursor-pointer group"
        title="Connected to customer storage bucket. All data encrypted before transfer."
      >
        <div class="flex items-center gap-2 min-w-0">
          <span class="relative flex h-1.5 w-1.5 flex-shrink-0">
            <span class={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${statusInfo().dotColor}`}></span>
            <span class={`relative inline-flex rounded-full h-1.5 w-1.5 ${statusInfo().dotColor}`}></span>
          </span>
          <span class="truncate font-medium">{statusInfo().label}</span>
        </div>
        <svg class="w-3.5 h-3.5 text-[#878A8E] group-hover:text-[#5E6063] stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      </button>

      {/* Popover Details */}
      <Show when={popoverOpen()}>
        <div class="absolute bottom-full left-0 mb-2 w-72 bg-white rounded-2xl border border-[#E2DFD8] shadow-xl p-4 text-xs space-y-3 z-50">
          <div class="flex items-center justify-between pb-2 border-b border-[#E2DFD8]">
            <span class="font-bold text-[#3C3D3E]">Storage Status</span>
            <button
              onClick={() => setPopoverOpen(false)}
              class="text-[#6F7173] hover:text-[#3C3D3E] cursor-pointer p-0.5"
              title="Close"
            >
              <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div class="space-y-2 text-[#3C3D3E]">
            <div class="flex justify-between items-center text-[11px]">
              <span class="text-[#6F7173]">Storage:</span>
              <span class="font-medium text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1.5">
                <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>Connected</span>
              </span>
            </div>
            <div class="flex justify-between items-center text-[11px]">
              <span class="text-[#6F7173]">Status:</span>
              <span class="font-medium">Synced</span>
            </div>
          </div>

          <p class="text-[11px] text-[#6F7173] leading-relaxed pt-1 border-t border-[#E2DFD8]">
            {statusInfo().details}
          </p>
        </div>
      </Show>
    </div>
  );
};
