import { Component } from "solid-js";
import { LCornerRail, AppModule } from "./LCornerRail";

export type { AppModule };

export interface RightBarProps {
  activeModule?: AppModule;
  onSwitchModule?: (mod: AppModule) => void;
  onOpenContacts?: () => void;
  isCustomizerOpen?: boolean;
  onToggleCustomizer?: () => void;
  theme?: string;
  onToggleTheme?: () => void;
}

export const RightBar: Component<RightBarProps> = (props) => {
  return (
    <div
      class="hidden md:flex flex-col items-end z-50 select-none flex-shrink-0 relative w-12 h-full pointer-events-none"
    >
      <div class="pointer-events-auto">
        <LCornerRail
          activeModule={props.activeModule}
          onSwitchModule={props.onSwitchModule}
          isCustomizerOpen={props.isCustomizerOpen}
          onToggleCustomizer={props.onToggleCustomizer}
          theme={props.theme}
          onToggleTheme={props.onToggleTheme}
          class="absolute top-0 right-0"
        />
      </div>
    </div>
  );
};
