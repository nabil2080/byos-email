# Migrating from Apple Mail

This guide explains how to export your email mailboxes from Apple Mail (macOS) and import them into BYOS Email.

---

## 1. What is Apple Mail Export?

Apple Mail has native, built-in support for exporting any folder or mailbox as a standard `.mbox` archive. This makes Apple Mail one of the easiest email clients to migrate from.

---

## 2. How to Export from Apple Mail (Step-by-Step)

Follow these steps on your Mac:

1. Open the **Mail** app on your Mac.
2. In the sidebar on the left, locate the mailbox or folder you want to export (e.g., `Inbox`, `Sent`, `Archive`, or custom folders).
   *(Tip: To export multiple mailboxes, hold `Cmd` and click each mailbox).*
3. Right-click (or Control-click) the mailbox, or click the **Mailbox** menu at the top of the screen.
4. Select **Export Mailbox...**.
5. Choose a destination folder (such as your Desktop or Downloads folder) and click **Choose**.
6. Apple Mail creates a `.mbox` folder package for each exported mailbox (e.g., `Inbox.mbox` or `Sent.mbox`).

---

## 3. How Long Does the Export Take?

- **Standard mailboxes (< 1 GB)**: 10 to 30 seconds.
- **Large mailboxes (5–10 GB)**: 2 to 5 minutes.
Exporting is performed locally from your Mac's stored email cache and does not require downloading from the server again.

---

## 4. How to Prepare Your Files

Inside each exported `.mbox` package, macOS stores the archive as an mbox file:
- On macOS, `.mbox` folders can usually be dropped directly into modern Chromium or WebKit browsers.
- If your browser treats the `.mbox` as a folder rather than a file, navigate inside the folder to find the `mbox` file, or compress the folder into a `.zip` and extract it.

---

## 5. How to Import into BYOS

1. Open BYOS Webmail (`https://mail.byos.local` or your domain).
2. Click **Import Emails** from the sidebar or settings.
3. Drag your exported `.mbox` file(s) into the drop zone.
4. If you exported your `Sent.mbox`, select the `Sent` target folder, or let BYOS automatically detect outgoing messages via sender email address matching.
5. Click **Import Emails**.
6. BYOS will process messages in 64KB streaming chunks, encrypt each message client-side, and upload concurrently using the 4-worker pipeline.

---

## 6. What BYOS Does and Doesn't Import

| Feature | Handled by BYOS Import? | Details |
| :--- | :--- | :--- |
| **Email content, formatting, & attachments** | ✅ Yes | Full preservation of text, HTML, headers, and attachments. |
| **Sender matching (Sent folder)** | ✅ Yes | Messages from your email address are mapped to Sent. |
| **Deduplication** | ✅ Yes | Re-importing duplicate archives skips already imported messages. |
| **Apple Mail VIP / Smart Mailboxes** | ❌ No | Smart mailboxes are dynamic search queries; export the underlying mailboxes instead. |
| **Apple Mail Flags** | ⚠️ Partial | Headers and timestamps preserved; flags can be applied in BYOS. |

---

## 7. Troubleshooting & FAQs

### What if I have multiple Apple Mail accounts?
Export each account's mailboxes individually to keep things organized. You can drop multiple `.mbox` files into the BYOS importer in a single batch.

### What if an upload is interrupted?
BYOS importer includes beforeunload protection to prevent accidental tab closing. If your session is interrupted, you can safely re-drop the file; existing messages will be recognized as "Already exists" without re-uploading or duplicating.
