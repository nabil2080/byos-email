import { DriveStep } from "driver.js";

export const CONTROL_PLANE_V1_ID = "control_plane_v1";

export const controlPlaneSteps: DriveStep[] = [
  {
    element: '[data-testid="dashboard-overview"]',
    popover: {
      title: "Welcome to BYOS Control Panel",
      description:
        "Manage your sovereign organization, verified domains, cryptographic mailboxes, and enterprise storage all in one place.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: '[data-testid="nav-domains"]',
    popover: {
      title: "Verified Domains",
      description:
        "Connect and cryptographically verify corporate domains with DKIM, SPF, and MX DNS records for authenticated delivery.",
      side: "right",
      align: "center",
    },
  },
  {
    element: '[data-testid="nav-mailboxes"]',
    popover: {
      title: "Cryptographic Mailboxes",
      description:
        "Provision zero-knowledge encrypted user mailboxes with client-side key generation and sovereign privacy boundaries.",
      side: "right",
      align: "center",
    },
  },
  {
    element: '[data-testid="nav-members"]',
    popover: {
      title: "Team & Role Access",
      description:
        "Administer organization membership, delegate administrative roles, and track invitation activations across seats.",
      side: "right",
      align: "center",
    },
  },
  {
    element: '[data-testid="nav-storage"]',
    popover: {
      title: "Storage Governance",
      description:
        "Connect customer-controlled S3 or local disk storage with live health telemetry and encrypted object persistence.",
      side: "right",
      align: "center",
    },
  },
  {
    element: '[data-testid="nav-billing"]',
    popover: {
      title: "Seat-Based Capacity",
      description:
        "Scale your organization with transparent graduated per-seat pricing brackets and full feature availability across every seat.",
      side: "right",
      align: "center",
    },
  },
  {
    element: '[data-testid="nav-settings"]',
    popover: {
      title: "Security & Governance",
      description:
        "Configure FIDO2 passkeys, audit recovery phrases, enforce multi-factor authentication, or replay this tour anytime.",
      side: "right",
      align: "center",
    },
  },
];
