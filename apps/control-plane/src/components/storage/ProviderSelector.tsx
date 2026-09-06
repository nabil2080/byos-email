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
    <div role="radiogroup" aria-label="Storage provider" class="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {options.map((opt) => (
        <label
          class={`relative flex cursor-pointer flex-col rounded-lg border p-4 hover:bg-slate-50 focus-within:ring-2 focus-within:ring-sky-500 ${
            props.value === opt.value ? "border-sky-600 ring-1 ring-sky-600" : "border-slate-200"
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
          <span class="flex items-center gap-2 text-sm font-medium text-slate-900">
            {opt.label}
            {opt.badge && (
              <span class="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">{opt.badge}</span>
            )}
          </span>
          <span class="mt-1 text-xs text-slate-500">{opt.desc}</span>
        </label>
      ))}
    </div>
  );
};

export default ProviderSelector;
