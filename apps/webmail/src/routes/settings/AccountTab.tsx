import { Component, createSignal, Show } from "solid-js";
import { Mailbox, UserMe, uploadProfilePhoto, deleteProfilePhoto } from "../../api";
import { ProfileAvatar } from "../../components/ProfileAvatar";
import { encryptChunk } from "../../attachment_crypto";

export interface AccountTabProps {
  mailbox: Mailbox;
  currentUser: UserMe | null;
  mailboxKey: Uint8Array | null;
  profilePhotoUrl: string | null;
  onPhotoUpdated: (newUrl: string | null, newRef: string | null) => void;
  showToast?: (msg: string) => void;
}

export function resizeImageToSquareBlob(file: File, targetDim = 256): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = targetDim;
        canvas.height = targetDim;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas context unavailable"));
          return;
        }
        const minSide = Math.min(img.width, img.height);
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, targetDim, targetDim);
        canvas.toBlob(
          (b) => {
            if (b) resolve(b);
            else reject(new Error("Failed to export image blob"));
          },
          "image/jpeg",
          0.85
        );
      };
      img.onerror = () => reject(new Error("Failed to load selected image"));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export const AccountTab: Component<AccountTabProps> = (props) => {
  const [uploading, setUploading] = createSignal(false);
  const [removing, setRemoving] = createSignal(false);
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);
  let fileInputRef: HTMLInputElement | undefined;

  const email = () => props.currentUser?.email || `${props.mailbox.local_part}@byos.local`;
  const displayName = () => props.currentUser?.display_name || props.mailbox.local_part;
  const hasPhoto = () => Boolean(props.profilePhotoUrl || props.currentUser?.profile_photo_ref || props.mailbox.profile_photo_ref);

  async function handleFileSelected(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];

    // Validate size (max 2 MB)
    if (file.size > 2 * 1024 * 1024) {
      setErrorMessage("Selected image exceeds 2 MB limit");
      input.value = "";
      return;
    }

    // Validate type
    const validTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
    if (!validTypes.includes(file.type.toLowerCase())) {
      setErrorMessage("Image must be PNG, JPEG, or WebP");
      input.value = "";
      return;
    }

    if (!props.mailboxKey) {
      setErrorMessage("Mailbox cryptographic key is not available in memory");
      input.value = "";
      return;
    }

    setUploading(true);
    setErrorMessage(null);

    try {
      // 1. Resize client-side to 256x256 square crop
      const squareBlob = await resizeImageToSquareBlob(file, 256);
      const arrayBuffer = await squareBlob.arrayBuffer();
      const plaintext = new Uint8Array(arrayBuffer);

      // 2. Encrypt using active mailbox symmetric key (AES-256-GCM)
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await encryptChunk(plaintext, props.mailboxKey, iv);

      // 3. Upload to storage via API
      const result = await uploadProfilePhoto(ciphertext);

      // 4. Create object URL for client preview
      const objectUrl = URL.createObjectURL(squareBlob);
      props.onPhotoUpdated(objectUrl, result.photo_ref);

      props.showToast?.("Profile photo uploaded and encrypted successfully");
    } catch (err: any) {
      setErrorMessage(err?.message || "Failed to upload profile photo");
    } finally {
      setUploading(false);
      input.value = "";
    }
  }

  async function handleRemovePhoto() {
    setRemoving(true);
    setErrorMessage(null);

    try {
      await deleteProfilePhoto();
      props.onPhotoUpdated(null, null);
      props.showToast?.("Profile photo removed");
    } catch (err: any) {
      setErrorMessage(err?.message || "Failed to remove profile photo");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div class="space-y-6 max-w-4xl mx-auto py-2">
      <div>
        <h2 class="text-lg font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">Account Settings</h2>
        <p class="text-xs text-[#6E7075] dark:text-[#878A8E] mt-0.5">
          Manage your personal identity, display details, and sovereign profile photo.
        </p>
      </div>

      {/* Profile Photo Section */}
      <section
        data-testid="profile-photo-section"
        class="bg-white dark:bg-[#1E2025] rounded-2xl border border-[#E2DFD8] dark:border-[#2E3138] p-6 shadow-xs"
      >
        <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-5 border-b border-[#E2DFD8] dark:border-[#2E3138]">
          <div>
            <h3 class="text-sm font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]">Profile Photo</h3>
            <p class="text-xs text-[#6E7075] dark:text-[#878A8E] mt-0.5">
              Client-side encrypted with your mailbox key before storage. Scaled to 256×256px.
            </p>
          </div>
          <span class="text-[11px] font-mono font-medium px-2 py-0.5 rounded-full bg-[#F0EEE9] dark:bg-[#2A2D34] text-[#878A8E]">
            End-to-End Encrypted
          </span>
        </div>

        <div class="mt-6 flex flex-col sm:flex-row items-center gap-6">
          {/* Avatar Preview */}
          <div class="relative flex-shrink-0">
            <ProfileAvatar
              mailboxId={props.mailbox.id}
              email={email()}
              displayName={displayName()}
              photoUrl={props.profilePhotoUrl}
              size="header"
              class="w-20 h-20 min-w-20 min-h-20 text-2xl ring-4 ring-[#FAF9F7] dark:ring-[#26282E]"
              testId="settings-avatar-preview"
            />
            <Show when={uploading()}>
              <div class="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center text-white text-xs font-medium backdrop-blur-xs">
                ...
              </div>
            </Show>
          </div>

          <div class="flex-1 space-y-2 text-center sm:text-left">
            <div class="flex flex-wrap items-center justify-center sm:justify-start gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleFileSelected}
                class="hidden"
                data-testid="profile-photo-file-input"
              />
              <button
                type="button"
                data-testid="upload-photo-btn"
                disabled={uploading() || removing()}
                onClick={() => fileInputRef?.click()}
                class="px-3.5 py-1.5 rounded-xl bg-[#A27561] hover:bg-[#8F6452] text-white text-xs font-semibold shadow-xs transition cursor-pointer disabled:opacity-50"
              >
                {uploading() ? "Encrypting & Uploading…" : "Upload photo"}
              </button>

              <Show when={hasPhoto()}>
                <button
                  type="button"
                  data-testid="remove-photo-btn"
                  disabled={uploading() || removing()}
                  onClick={handleRemovePhoto}
                  class="px-3.5 py-1.5 rounded-xl border border-rose-300 dark:border-rose-900/60 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-xs font-semibold shadow-xs transition cursor-pointer disabled:opacity-50"
                >
                  {removing() ? "Removing…" : "Remove photo"}
                </button>
              </Show>
            </div>
            <p class="text-[11px] text-[#878A8E]">
              Supported formats: PNG, JPEG, WebP. Maximum file size: 2 MB.
            </p>
            <Show when={errorMessage()}>
              <p class="text-xs text-rose-600 dark:text-rose-400 font-medium" data-testid="photo-error-message">
                {errorMessage()}
              </p>
            </Show>
          </div>
        </div>
      </section>

      {/* Account Info Details */}
      <section class="bg-white dark:bg-[#1E2025] rounded-2xl border border-[#E2DFD8] dark:border-[#2E3138] p-6 shadow-xs space-y-4">
        <h3 class="text-sm font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]">Identity Information</h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div class="space-y-1">
            <span class="text-[#878A8E] font-medium">Display Name</span>
            <div class="font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] p-2 rounded-xl bg-[#FAF9F7] dark:bg-[#26282E] border border-[#E2DFD8] dark:border-[#2E3138]">
              {displayName()}
            </div>
          </div>
          <div class="space-y-1">
            <span class="text-[#878A8E] font-medium">Primary Email</span>
            <div class="font-mono text-[#1A1B1E] dark:text-[#F3F4F6] p-2 rounded-xl bg-[#FAF9F7] dark:bg-[#26282E] border border-[#E2DFD8] dark:border-[#2E3138]">
              {email()}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
