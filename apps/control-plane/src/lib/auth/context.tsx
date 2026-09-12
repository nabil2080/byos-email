/**
 * Unified auth context re-exporting from src/context/OrgContext.tsx
 */
export * from "../../context/OrgContext";
export { OrgProvider as AuthProvider } from "../../context/OrgContext";
export { useOrg as useAuthContext } from "../../context/OrgContext";
