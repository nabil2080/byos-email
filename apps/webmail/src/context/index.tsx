import type { JSX } from "solid-js";
import { AuthProvider, type AuthContextValue } from "./AuthContext";
import { ModalProvider, type ModalContextValue } from "./ModalContext";
import { MailProvider, type MailContextValue } from "./MailContext";

export * from "./AuthContext";
export * from "./ModalContext";
export * from "./MailContext";

export interface AppProvidersProps {
  authValue?: AuthContextValue;
  modalValue?: ModalContextValue;
  mailValue?: MailContextValue;
  children: JSX.Element;
}

export function AppProviders(props: AppProvidersProps) {
  return (
    <AuthProvider value={props.authValue}>
      <ModalProvider value={props.modalValue}>
        <MailProvider value={props.mailValue}>
          {props.children}
        </MailProvider>
      </ModalProvider>
    </AuthProvider>
  );
}
