import { Component } from "solid-js";
import type { StorageProvider } from "../../lib/api/storage";

interface Props {
  value: StorageProvider;
  onChange: (p: StorageProvider) => void;
  disabled?: boolean;
}

const options: Array<{ value: StorageProvider; label: string; desc: string; badge?: string }> = [
  { value: "minio", label: "MinIO", desc: "Self-hosted S3-compatible" },
  { value: "s3", label: "S3", desc: "AWS S3 or compatible" },
  { value: "google_drive_mock", label: "Google Drive Mock", desc: "Filesystem mock at /tmp/byos-drive-mock", badge: "DEV" },
  { value: "google_drive", label: "Google Drive", desc: "OAuth access token, encrypted at rest", badge: "OAUTH" },
];

const ProviderSelector: Component<Props> = (props) => {
  return (
    <div role="radiogroup" aria-label="Storage provider" class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {options.map((opt) => (
        <label
          class={`relative flex cursor-pointer flex-col rounded-xl border p-4 transition-all focus-within:ring-2 focus-within:ring-[#9E725F] ${
            props.value === opt.value
              ? "border-[#9E725F] ring-1 ring-[#9E725F] bg-[#F3ECE8]/50 shadow-xs"
              : "border-[#E2DFD8] bg-white hover:border-[#9E725F] hover:bg-[#F3ECE8]/30"
          } ${props.disabled ? "opacity-50 pointer-events-none" : ""}`}
        >
          <input
            type="radio"
            name="provider"
            value={opt.value}
            checked={props.value === opt.value}
            onChange={() => props.onChange(opt.value)}
            class="sr-only"
            disabled={props.disabled}
          />
          <span class="flex items-center gap-2 text-xs sm:text-sm font-bold text-[#3C3D3E]">
            {opt.label}
            {opt.badge && (
              <span class="rounded-md bg-[#9E725F]/15 px-2 py-0.5 text-[10px] font-bold font-mono text-[#9E725F]">
                {opt.badge}
              </span>
            )}
          </span>
          <span class="mt-1 text-[11px] text-[#6F7173] leading-normal">{opt.desc}</span>
        </label>
      ))}
    </div>
  );
};

export default ProviderSelector;
