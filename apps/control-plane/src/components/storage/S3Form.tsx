import { Component, createSignal } from "solid-js";

interface Props {
  endpoint: string;
  setEndpoint: (v: string) => void;
  bucket: string;
  setBucket: (v: string) => void;
  accessKey: string;
  setAccessKey: (v: string) => void;
  secretKey: string;
  setSecretKey: (v: string) => void;
  region: string;
  setRegion: (v: string) => void;
  pathStyle: boolean;
  setPathStyle: (v: boolean) => void;
  disabled?: boolean;
  errors?: Record<string, string>;
}

const S3Form: Component<Props> = (props) => {
  const [showSecret, setShowSecret] = createSignal(false);

  return (
    <div class="space-y-4">
      <div>
        <label for="endpoint" class="block text-xs font-semibold text-[#3C3D3E] mb-1.5">
          Endpoint URL
        </label>
        <input
          id="endpoint"
          type="text"
          autocomplete="off"
          spellcheck={false}
          value={props.endpoint}
          onInput={(e) => props.setEndpoint(e.currentTarget.value)}
          placeholder="e.g. minio:9000 or s3.us-east-1.amazonaws.com"
          disabled={props.disabled}
          aria-invalid={!!props.errors?.endpoint}
          aria-describedby={props.errors?.endpoint ? "err-endpoint" : undefined}
          class="block w-full rounded-xl border border-[#E2DFD8] bg-[#F0EEE9]/40 px-3.5 py-2 text-xs sm:text-sm text-[#3C3D3E] placeholder-[#6F7173] focus:outline-none focus:border-[#9E725F] focus:ring-1 focus:ring-[#9E725F]"
        />
        {props.errors?.endpoint && (
          <p id="err-endpoint" class="mt-1 text-xs text-rose-600">
            {props.errors.endpoint}
          </p>
        )}
      </div>

      <div>
        <label for="bucket" class="block text-xs font-semibold text-[#3C3D3E] mb-1.5">
          Bucket Name
        </label>
        <input
          id="bucket"
          type="text"
          autocomplete="off"
          spellcheck={false}
          value={props.bucket}
          onInput={(e) => props.setBucket(e.currentTarget.value)}
          placeholder="byos-mailbox"
          disabled={props.disabled}
          aria-invalid={!!props.errors?.bucket}
          class="block w-full rounded-xl border border-[#E2DFD8] bg-[#F0EEE9]/40 px-3.5 py-2 text-xs sm:text-sm text-[#3C3D3E] placeholder-[#6F7173] focus:outline-none focus:border-[#9E725F] focus:ring-1 focus:ring-[#9E725F]"
        />
        {props.errors?.bucket && <p class="mt-1 text-xs text-rose-600">{props.errors.bucket}</p>}
      </div>

      <div>
        <label for="access_key" class="block text-xs font-semibold text-[#3C3D3E] mb-1.5">
          Access Key ID
        </label>
        <input
          id="access_key"
          type="text"
          autocomplete="off"
          spellcheck={false}
          value={props.accessKey}
          onInput={(e) => props.setAccessKey(e.currentTarget.value)}
          disabled={props.disabled}
          aria-invalid={!!props.errors?.access_key}
          class="block w-full rounded-xl border border-[#E2DFD8] bg-[#F0EEE9]/40 px-3.5 py-2 text-xs sm:text-sm font-mono text-[#3C3D3E] placeholder-[#6F7173] focus:outline-none focus:border-[#9E725F] focus:ring-1 focus:ring-[#9E725F]"
        />
        {props.errors?.access_key && <p class="mt-1 text-xs text-rose-600">{props.errors.access_key}</p>}
      </div>

      <div>
        <label for="secret_key" class="block text-xs font-semibold text-[#3C3D3E] mb-1.5">
          Secret Access Key
        </label>
        <div class="mt-1 flex gap-2">
          <input
            id="secret_key"
            type={showSecret() ? "text" : "password"}
            autocomplete="new-password"
            spellcheck={false}
            value={props.secretKey}
            onInput={(e) => props.setSecretKey(e.currentTarget.value)}
            disabled={props.disabled}
            aria-invalid={!!props.errors?.secret_key}
            class="block w-full rounded-xl border border-[#E2DFD8] bg-[#F0EEE9]/40 px-3.5 py-2 text-xs sm:text-sm font-mono text-[#3C3D3E] placeholder-[#6F7173] focus:outline-none focus:border-[#9E725F] focus:ring-1 focus:ring-[#9E725F]"
          />
          <button
            type="button"
            onClick={() => setShowSecret((v) => !v)}
            class="rounded-xl border border-[#E2DFD8] px-3.5 py-2 text-xs font-medium text-[#6F7173] hover:text-[#3C3D3E] hover:bg-[#F3ECE8] transition-colors shrink-0"
            aria-label={showSecret() ? "Hide secret key" : "Show secret key"}
          >
            {showSecret() ? "Hide" : "Show"}
          </button>
        </div>
        {props.errors?.secret_key && <p class="mt-1 text-xs text-rose-600">{props.errors.secret_key}</p>}
      </div>

      <div>
        <label for="region" class="block text-xs font-semibold text-[#3C3D3E] mb-1.5">
          Region <span class="text-[#6F7173] font-normal">(optional)</span>
        </label>
        <input
          id="region"
          type="text"
          autocomplete="off"
          value={props.region}
          onInput={(e) => props.setRegion(e.currentTarget.value)}
          placeholder="us-east-1"
          disabled={props.disabled}
          class="block w-full rounded-xl border border-[#E2DFD8] bg-[#F0EEE9]/40 px-3.5 py-2 text-xs sm:text-sm text-[#3C3D3E] placeholder-[#6F7173] focus:outline-none focus:border-[#9E725F] focus:ring-1 focus:ring-[#9E725F]"
        />
      </div>

      <div class="flex items-center gap-2.5 pt-1">
        <input
          id="path_style"
          type="checkbox"
          checked={props.pathStyle}
          onChange={(e) => props.setPathStyle(e.currentTarget.checked)}
          disabled={props.disabled}
          class="h-4 w-4 rounded border-[#E2DFD8] text-[#9E725F] focus:ring-[#9E725F]"
        />
        <label for="path_style" class="text-xs font-medium text-[#3C3D3E] select-none">
          Path-style addressing (required for MinIO and local testing)
        </label>
      </div>
    </div>
  );
};

export default S3Form;
