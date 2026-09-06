import { Component } from "solid-js";

interface Props {
  root: string;
  setRoot: (v: string) => void;
  disabled?: boolean;
  errors?: Record<string, string>;
}

const MockForm: Component<Props> = (props) => {
  return (
    <div class="space-y-4">
      <div class="rounded-md bg-amber-50 p-3 text-xs text-amber-800">
        Development mock — files are stored under a temporary directory on the server. Do not use in production.
      </div>
      <div>
        <label for="root" class="block text-sm font-medium text-slate-700">
          Root directory <span class="text-slate-400">(optional)</span>
        </label>
        <input
          id="root"
          type="text"
          autocomplete="off"
          value={props.root}
          onInput={(e) => props.setRoot(e.currentTarget.value)}
          placeholder="/tmp/byos-drive-mock"
          disabled={props.disabled}
          aria-invalid={!!props.errors?.root}
          class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        {props.errors?.root && <p class="mt-1 text-xs text-red-600">{props.errors.root}</p>}
        <p class="mt-1 text-xs text-slate-500">Leave empty to use the default temporary directory.</p>
      </div>
    </div>
  );
};

export default MockForm;
