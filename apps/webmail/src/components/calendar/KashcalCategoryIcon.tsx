import { Component } from "solid-js";
import { KashcalCategory } from "./kashcalParser";

interface KashcalCategoryIconProps {
  category: KashcalCategory;
  class?: string;
  style?: Record<string, string | number>;
}

export const KashcalCategoryIcon: Component<KashcalCategoryIconProps> = (props) => {
  const cls = () => props.class || "w-3.5 h-3.5 stroke-current fill-none stroke-[2] shrink-0";

  return (
    <>
      {props.category === "coffee" && (
        <svg class={cls()} style={props.style} viewBox="0 0 24 24" aria-label="Coffee">
          <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
          <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
          <line x1="6" y1="1" x2="6" y2="4" />
          <line x1="10" y1="1" x2="10" y2="4" />
          <line x1="14" y1="1" x2="14" y2="4" />
        </svg>
      )}
      {props.category === "food" && (
        <svg class={cls()} style={props.style} viewBox="0 0 24 24" aria-label="Food & Dining">
          <path d="M18 2v20M18 2a3 3 0 0 0-3 3v4a3 3 0 0 0 3 3h0a3 3 0 0 0 3-3V5a3 3 0 0 0-3-3z" />
          <path d="M6 2v20M3 2v6a3 3 0 0 0 6 0V2" />
        </svg>
      )}
      {props.category === "meeting" && (
        <svg class={cls()} style={props.style} viewBox="0 0 24 24" aria-label="Meeting / Sync">
          <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
          <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
        </svg>
      )}
      {props.category === "flight" && (
        <svg class={cls()} style={props.style} viewBox="0 0 24 24" aria-label="Flight & Travel">
          <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.3c.4-.2.6-.6.5-1.1z" />
        </svg>
      )}
      {props.category === "call" && (
        <svg class={cls()} style={props.style} viewBox="0 0 24 24" aria-label="Call">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
      )}
      {props.category === "health" && (
        <svg class={cls()} style={props.style} viewBox="0 0 24 24" aria-label="Health & Doctor">
          <path d="M11 2v4a2 2 0 0 1-2 2H5a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h4a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-4a2 2 0 0 1 2-2h4a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2h-4a2 2 0 0 1-2-2V2a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2z" />
        </svg>
      )}
      {props.category === "workout" && (
        <svg class={cls()} style={props.style} viewBox="0 0 24 24" aria-label="Workout & Gym">
          <path d="m6.5 6.5 11 11" />
          <path d="m21 21-1-1" />
          <path d="m3 3 1 1" />
          <path d="m18 22 4-4" />
          <path d="m2 6 4-4" />
          <path d="m3 10 7-7" />
          <path d="m14 21 7-7" />
        </svg>
      )}
      {props.category === "party" && (
        <svg class={cls()} style={props.style} viewBox="0 0 24 24" aria-label="Celebration">
          <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
        </svg>
      )}
      {props.category === "focus" && (
        <svg class={cls()} style={props.style} viewBox="0 0 24 24" aria-label="Focus Time">
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="6" />
          <circle cx="12" cy="12" r="2" />
        </svg>
      )}
      {props.category === "general" && (
        <svg class={cls()} style={props.style} viewBox="0 0 24 24" aria-label="Event">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      )}
    </>
  );
};
