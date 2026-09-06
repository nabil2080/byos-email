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
        <label for="endpoint" class="block text-sm font-medium text-slate-700">
          Endpoint
        </label>
        <input
          id="endpoint"
          type="text"
          autocomplete="off"
          spellcheck={false}
          value={props.endpoint}
          onInput={(e) => props.setEndpoint(e.currentTarget.value)}
          placeholder="minio:9000"
          disabled={props.disabled}
          aria-invalid={!!props.errors?.endpoint}
          aria-describedby={props.errors?.endpoint ? "err-endpoint" : undefined}
          class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:ring-sky-500"
        />
        {props.errors?.endpoint && (
          <p id="err-endpoint" class="mt-1 text-xs text-red-600">
            {props.errors.endpoint}
          </p>
        )}
      </div>

      <div>
        <label for="bucket" class="block text-sm font-medium text-slate-700">
          Bucket
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
          class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        {props.errors?.bucket && <p class="mt-1 text-xs text-red-600">{props.errors.bucket}</p>}
      </div>

      <div>
        <label for="access_key" class="block text-sm font-medium text-slate-700">
          Access key
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
          class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        {props.errors?.access_key && <p class="mt-1 text-xs text-red-600">{props.errors.access_key}</p>}
      </div>

      <div>
        <label for="secret_key" class="block text-sm font-medium text-slate-700">
          Secret key
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
            class="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => setShowSecret((v) => !v)}
            class="rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"
            aria-label={showSecret() ? "Hide secret key" : "Show secret key"}
          >
            {showSecret() ? "Hide" : "Show"}
          </button>
        </div>
        {props.errors?.secret_key && <p class="mt-1 text-xs text-red-600">{props.errors.secret_key}</p>}
      </div>

      <div>
        <label for="region" class="block text-sm font-medium text-slate-700">
          Region <span class="text-slate-400">(optional)</span>
        </label>
        <input
          id="region"
          type="text"
          autocomplete="off"
          value={props.region}
          onInput={(e) => props.setRegion(e.currentTarget.value)}
          placeholder="us-east-1"
          disabled={props.disabled}
          class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      <div class="flex items-center gap-2">
        <input
          id="path_style"
          type="checkbox"
          checked={props.pathStyle}
          onChange={(e) => props.setPathStyle(e.currentTarget.checked)}
          disabled={props.disabled}
          class="h-4 w-4 rounded border-slate-300 text-sky-600"
        />
        <label for="path_style" class="text-sm text-slate-700">
          Path-style addressing
        </label>
      </div>
    </div>
  );
};

export default S3Form;
