# BYOS Zero-Knowledge Support CRM: Implementation Roadmap

**Target Executor:** Antigravity (Agent/Development Team)
**Architecture Standard:** Blind Telemetry & Verifier-Only Recovery
**Tech Stack:** SolidJS, Tailwind, WASM/Crypto Core, Go/Rust Backend, PostgreSQL

## Phase 1: Infrastructure Isolation & Database Guardrails
*Objective: Mathematically guarantee that support agents cannot access payloads or cryptographic secrets, even if the CRM is compromised.*

### 1.1 PostgreSQL Row-Level Security (RLS) Configuration
* **Action:** Create a dedicated, restricted database role (e.g., `role_support_agent`).
* **Constraint:** Implement strict RLS policies that explicitly `DENY SELECT` on `encrypted_payload`, `password_hash`, `master_key`, and `recovery_verifier` columns.
* **Isolation:** The CRM must join strictly on `mailbox_uuid` or `org_uuid`. It must never query `email_address` strings or account names in plaintext.

### 1.2 The Immutable Audit Ledger
* **Action:** Create an `audit_logs` table using PostgreSQL `JSONB` for high-volume telemetry ingestion.
* **Schema:** `id (UUID)`, `actor_uuid` (the support agent), `action_type`, `target_mailbox_uuid`, `metadata (JSONB)`, `timestamp`.
* **Constraint:** This table must be append-only. Configure a scheduled backend worker to partition and permanently drop raw logs older than 30 days to prevent disk bloat.

### 1.3 Hardware-Backed Identity Provider (IdP)
* **Action:** Architect an internal authentication gateway specifically for the `services/admin-api`.
* **Constraint:** Enforce mandatory WebAuthn/YubiKey for all internal developers and support staff. Do not use the same IdP or session table that manages consumer webmail clients.

---

## Phase 2: Telemetry Pipelines & Blind API Endpoints
*Objective: Surface system health and queue states to the CRM without exposing underlying user data.*

### 2.1 Aggregated Health Endpoints
* **Action:** Build the endpoint `GET /admin/v1/mailboxes/{uuid}/health`.
* **Returns:** Storage quota used vs. available, blob count, billing status, domain verification status (DKIM/SPF/DMARC), and active connection count.
* **Constraint:** If querying SMTP bridge bounce logs, explicitly strip plaintext sender/recipient addresses and subject lines in the Go backend *before* transmitting the JSON to the CRM.

### 2.2 Worker Queue Visualizers
* **Action:** Expose endpoints for `outbound_queue` depth and `outbox_seq` sequence numbers.
* **Purpose:** Allow support agents to visually see if a worker is jammed (e.g., `storage-worker` panic loop) without needing to inspect the contents of the jammed queue.

### 2.3 Scoped Intervention Mutations
* **Action:** Build strictly scoped `POST` endpoints for support to resolve specific issues:
  * `POST /admin/v1/sessions/revoke` (Kills all active JWTs/WebSockets for a compromised user).
  * `POST /admin/v1/queues/replay` (Forces the worker to retry a stalled transaction).
  * `POST /admin/v1/mailboxes/flag-reset` (Sets a database flag forcing the user into the offline recovery phrase flow upon their next login).

---

## Phase 3: Client-Side Diagnostics & Asymmetric Ticketing
*Objective: Shift the burden of debugging to the client side since the server is completely blind to payload contents.*

### 3.1 Sanitized Diagnostic Export (SolidJS Webmail)
* **Action:** Build a "Generate Support Log" utility inside the primary webmail client settings.
* **Logic:** Aggregates WASM error codes (e.g., `ErrInvalidKeyVersion`), IndexedDB local state, and network/bridge failures.
* **Constraint:** The utility must aggressively scrub all PII before generating a JSON blob that the user explicitly attaches to their support ticket.

### 3.2 Support-Key Encrypted Ticketing
* **Action:** Implement an in-app ticketing interface.
* **Logic:** When a user submits a ticket, encrypt the payload using the **Support Team's Public Key**, *not* the user's HPKE public key.
* **Purpose:** Ensures the support conversation lives outside the user's potentially corrupted inbox and can be decrypted securely by authorized support agents.

### 3.3 Zero-Knowledge State Reset (The Verifier Model)
* **Action:** Build the cryptographic recovery flow.
* **Logic:** When support triggers a "State Reset", the user is prompted to enter their offline phrase locally. The SolidJS client hashes the phrase to generate a cryptographic *verifier* and sends the verifier (not the phrase) to the server. The server compares the verifier to allow key regeneration. The CRM never touches the phrase.

---

## Phase 4: SolidJS Support CRM Frontend
*Objective: Build the administrative UI adhering strictly to the BYOS brand system and avoiding architectural overlap with the webmail client.*

### 4.1 Strict Project Isolation
* **Action:** Initialize the CRM as a completely separate application (`apps/support-crm`).
* **Constraint:** Do **not** import any `byos_crypto_core` WASM modules into the CRM. The CRM app must be intentionally and mathematically incapable of executing decryption logic.

### 4.2 Brand & Layout Adherence
* **Action:** Apply the strict BYOS brand palette to the Tailwind configuration.
  * Canvas/Backgrounds: Cloud Dancer (`#F0EEE9`)
  * Primary Actions/Buttons: Mocha Mousse (`#9E725F`)
  * Text/Borders/Linework: Neutral Charcoal (`#3C3D3E`)
* **Components:** Build a live streaming dashboard (via Server-Sent Events or WebSockets) to display a real-time ticker of backend telemetry and infrastructure error clusters.

### 4.3 Unified Search (Metadata Only)
* **Action:** Implement a global search bar in the CRM top-nav that only accepts Mailbox UUIDs, Organization UUIDs, or transaction hashes.
* **Constraint:** Ensure the UI physically prevents agents from attempting to search by email address or plaintext names, enforcing the zero-knowledge paradigm at the UX level.