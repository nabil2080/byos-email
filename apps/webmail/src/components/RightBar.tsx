import { Component } from "solid-js";

export type AppModule = "mail" | "calendar" | "notes";

export interface RightBarProps {
  activeModule?: AppModule;
  onSwitchModule?: (mod: AppModule) => void;
  onOpenContacts?: () => void;
  isCustomizerOpen?: boolean;
  onToggleCustomizer?: () => void;
  theme?: string;
  onToggleTheme?: () => void;
}

export const RightBar: Component<RightBarProps> = () => {
  return null;
};
