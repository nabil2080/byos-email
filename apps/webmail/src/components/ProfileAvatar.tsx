import { Component, createSignal, Show } from "solid-js";

export interface ProfileAvatarProps {
  email?: string;
  displayName?: string;
  avatarUrl?: string;
  size?: "xs" | "sm" | "md" | "lg";
  class?: string;
}

const COLOR_PALETTES = [
  { bg: "bg-[#F2E8E2] dark:bg-[#342722]", text: "text-[#A27561] dark:text-[#D5A795]", border: "border-[#E2DFD8] dark:border-[#4B3C35]" }, // Mocha
  { bg: "bg-blue-50 dark:bg-blue-950/50", text: "text-blue-600 dark:text-blue-300", border: "border-blue-200 dark:border-blue-800" },
  { bg: "bg-emerald-50 dark:bg-emerald-950/50", text: "text-emerald-600 dark:text-emerald-300", border: "border-emerald-200 dark:border-emerald-800" },
  { bg: "bg-indigo-50 dark:bg-indigo-950/50", text: "text-indigo-600 dark:text-indigo-300", border: "border-indigo-200 dark:border-indigo-800" },
  { bg: "bg-amber-50 dark:bg-amber-950/50", text: "text-amber-700 dark:text-amber-300", border: "border-amber-200 dark:border-amber-800" },
  { bg: "bg-rose-50 dark:bg-rose-950/50", text: "text-rose-600 dark:text-rose-300", border: "border-rose-200 dark:border-rose-800" },
  { bg: "bg-teal-50 dark:bg-teal-950/50", text: "text-teal-600 dark:text-teal-300", border: "border-teal-200 dark:border-teal-800" },
  { bg: "bg-purple-50 dark:bg-purple-950/50", text: "text-purple-600 dark:text-purple-300", border: "border-purple-200 dark:border-purple-800" },
];

function getHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function getInitials(name?: string, email?: string): string {
  const cleanName = (name || "").replace(/<.*?>/g, "").trim();
  if (cleanName) {
    const parts = cleanName.split(/[\s._-]+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    if (parts.length === 1 && parts[0].length >= 2) {
      return parts[0].slice(0, 2).toUpperCase();
    }
  }

  const cleanEmail = (email || "").replace(/<.*?>/g, "").trim();
  if (cleanEmail) {
    const userPart = cleanEmail.split("@")[0] || "";
    const parts = userPart.split(/[\s._-]+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return userPart.slice(0, 2).toUpperCase() || "?";
  }

  return "?";
}

export const ProfileAvatar: Component<ProfileAvatarProps> = (props) => {
  const [imgError, setImgError] = createSignal(false);

  const initials = () => getInitials(props.displayName, props.email);

  const palette = () => {
    const key = (props.email || props.displayName || "").toLowerCase();
    const idx = getHash(key) % COLOR_PALETTES.length;
    return COLOR_PALETTES[idx];
  };

  const sizeClasses = () => {
    switch (props.size) {
      case "xs":
        return "w-5 h-5 text-[9px]";
      case "sm":
        return "w-6 h-6 text-[10px]";
      case "lg":
        return "w-10 h-10 text-sm";
      case "md":
      default:
        return "w-8 h-8 text-xs";
    }
  };

  const resolvedAvatarUrl = () => {
    if (props.avatarUrl) return props.avatarUrl;
    if (props.email) {
      try {
        const stored = localStorage.getItem("byos_avatar_" + props.email.toLowerCase().trim());
        if (stored) return stored;
      } catch {}
    }
    return undefined;
  };

  return (
    <div
      class={`rounded-full flex items-center justify-center font-bold font-sans flex-shrink-0 select-none border overflow-hidden shadow-2xs ${
        palette().bg
      } ${palette().text} ${palette().border} ${sizeClasses()} ${props.class || ""}`}
      title={props.displayName ? `${props.displayName} (${props.email})` : props.email}
    >
      <Show
        when={resolvedAvatarUrl() && !imgError()}
        fallback={<span>{initials()}</span>}
      >
        <img
          src={resolvedAvatarUrl()!}
          alt={props.displayName || props.email || "Avatar"}
          onError={() => setImgError(true)}
          class="w-full h-full object-cover rounded-full"
        />
      </Show>
    </div>
  );
};
