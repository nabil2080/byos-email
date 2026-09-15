import { Component, Show } from "solid-js";
import { getFileTypeInfo, AttachmentCategory } from "../fileType";

export interface AttachmentBadgeProps {
  filename?: string;
  contentType?: string;
  category?: string;
  count?: number;
  showLabel?: boolean;
  size?: "xs" | "sm" | "md";
  class?: string;
}

export function renderFileTypeIcon(category: AttachmentCategory | string, iconSize = "w-3.5 h-3.5") {
  const cat = (category || "").toUpperCase();

  switch (cat) {
    case "PDF":
      return (
        <svg class={`${iconSize} stroke-current fill-none stroke-[1.8] flex-shrink-0`} viewBox="0 0 24 24">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <path d="M9 15h6" />
        </svg>
      );
    case "IMG":
      return (
        <svg class={`${iconSize} stroke-current fill-none stroke-[1.8] flex-shrink-0`} viewBox="0 0 24 24">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      );
    case "SHEET":
      return (
        <svg class={`${iconSize} stroke-current fill-none stroke-[1.8] flex-shrink-0`} viewBox="0 0 24 24">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="3" y1="15" x2="21" y2="15" />
          <line x1="9" y1="3" x2="9" y2="21" />
        </svg>
      );
    case "DOC":
      return (
        <svg class={`${iconSize} stroke-current fill-none stroke-[1.8] flex-shrink-0`} viewBox="0 0 24 24">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      );
    case "ZIP":
      return (
        <svg class={`${iconSize} stroke-current fill-none stroke-[1.8] flex-shrink-0`} viewBox="0 0 24 24">
          <polyline points="21 8 21 21 3 21 3 8" />
          <rect x="1" y="3" width="22" height="5" />
          <line x1="10" y1="12" x2="14" y2="12" />
        </svg>
      );
    default:
      return (
        <svg class={`${iconSize} stroke-current fill-none stroke-[1.8] flex-shrink-0`} viewBox="0 0 24 24">
          <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
          <polyline points="13 2 13 9 20 9" />
        </svg>
      );
  }
}

export const AttachmentBadge: Component<AttachmentBadgeProps> = (props) => {
  const info = () => {
    if (props.category) {
      return getFileTypeInfo("file." + props.category.toLowerCase(), "");
    }
    return getFileTypeInfo(props.filename, props.contentType);
  };

  const sizeClasses = () => {
    switch (props.size) {
      case "xs":
        return "text-[9px] px-1.5 py-0.5 gap-1";
      case "md":
        return "text-xs px-2.5 py-1 gap-1.5";
      case "sm":
      default:
        return "text-[10px] px-2 py-0.5 gap-1";
    }
  };

  const iconSize = () => {
    switch (props.size) {
      case "xs":
        return "w-3 h-3";
      case "md":
        return "w-4 h-4";
      case "sm":
      default:
        return "w-3.5 h-3.5";
    }
  };

  return (
    <div
      class={`inline-flex items-center font-mono font-bold tracking-wider rounded-md border flex-shrink-0 whitespace-nowrap shadow-2xs select-none ${
        info().badgeClass
      } ${sizeClasses()} ${props.class || ""}`}
      title={props.filename || info().label}
    >
      {renderFileTypeIcon(info().category, iconSize())}
      <Show when={props.showLabel !== false}>
        <span>{info().label}</span>
      </Show>
      <Show when={props.count && props.count > 1}>
        <span class="opacity-80 font-semibold">({props.count})</span>
      </Show>
    </div>
  );
};
