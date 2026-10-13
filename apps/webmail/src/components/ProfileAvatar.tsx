import { Component, createSignal, Show } from "solid-js";
import { getAccountColor } from "../api";

export interface ProfileAvatarProps {
  mailboxId?: string;
  email?: string;
  displayName?: string;
  photoUrl?: string | null;
  avatarUrl?: string | null;
  isAll?: boolean;
  size?: "dropdown" | "chip" | "row" | "header" | "xs" | "sm" | "md" | "lg";
  class?: string;
  testId?: string;
}

export function getInitial(displayName?: string, email?: string): string {
  const cleanName = (displayName || "").replace(/<.*?>/g, "").trim();
  if (cleanName) {
    const first = cleanName.charAt(0).toUpperCase();
    if (first) return first;
  }

  const cleanEmail = (email || "").replace(/<.*?>/g, "").trim();
  if (cleanEmail) {
    const localPart = cleanEmail.split("@")[0] || "";
    const first = localPart.charAt(0).toUpperCase();
    if (first) return first;
  }

  return "?";
}

export const ProfileAvatar: Component<ProfileAvatarProps> = (props) => {
  const [imgError, setImgError] = createSignal(false);

  const initial = () => {
    if (props.isAll || props.mailboxId === "__all__") return "A";
    return getInitial(props.displayName, props.email);
  };

  const bgColor = () => {
    if (props.isAll || props.mailboxId === "__all__") return "#A27561";
    return getAccountColor(props.mailboxId || props.email || "");
  };

  const sizeClasses = () => {
    switch (props.size) {
      case "dropdown":
      case "xs":
        return "w-5 h-5 min-w-5 min-h-5 text-[10px]"; // 20x20
      case "chip":
        return "w-6 h-6 min-w-6 min-h-6 text-xs"; // 24x24
      case "row":
      case "sm":
        return "w-7 h-7 min-w-7 min-h-7 text-xs"; // 28x28
      case "header":
      case "lg":
        return "w-9 h-9 min-w-9 min-h-9 text-sm"; // 36x36
      case "md":
      default:
        return "w-7 h-7 min-w-7 min-h-7 text-xs"; // default 28x28
    }
  };

  const resolvedPhotoUrl = () => {
    if (props.photoUrl) return props.photoUrl;
    if (props.avatarUrl) return props.avatarUrl;
    return undefined;
  };

  return (
    <div
      data-testid={props.testId || "profile-avatar"}
      class={`rounded-full flex items-center justify-center font-medium font-sans flex-shrink-0 select-none overflow-hidden text-white shadow-2xs transition-colors ${sizeClasses()} ${
        props.class || ""
      }`}
      style={{
        "background-color": bgColor(),
      }}
      title={props.displayName ? `${props.displayName} (${props.email || ""})` : props.email || ""}
    >
      <Show
        when={resolvedPhotoUrl() && !imgError()}
        fallback={<span data-testid="avatar-fallback-initial" class="leading-none select-none">{initial()}</span>}
      >
        <img
          src={resolvedPhotoUrl()!}
          alt={props.displayName || props.email || "Profile Photo"}
          onError={() => setImgError(true)}
          data-testid="avatar-photo-img"
          class="w-full h-full object-cover rounded-full"
        />
      </Show>
    </div>
  );
};
