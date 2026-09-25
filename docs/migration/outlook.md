# Migrating from Microsoft Outlook

This guide explains how to export your email from Microsoft Outlook (Classic desktop, new Outlook, or Outlook on the web) and import it into BYOS Email.

---

## 1. What is Outlook Export?

Microsoft Outlook stores email messages in either proprietary containers (`.pst` or `.ost`), standard `.eml` files (single messages), or can be connected via IMAP to export standard `.mbox` files.

BYOS Webmail supports:
- **`.eml` files**: Individual RFC 822 messages dragged and dropped into the webmail interface.
- **`.mbox` files**: Standard multi-message mail archives exported from desktop clients.

---

## 2. How to Export from Outlook (Step-by-Step)

### Option A: Drag & Drop .eml (Best for Small to Medium Batches)
1. Open the Outlook desktop application or Outlook on the web.
2. Select one or more emails (hold `Ctrl` or `Shift` to multi-select).
3. Drag the selected messages out of Outlook directly into a folder on your computer (or directly into the BYOS Webmail drop zone).
4. Outlook will create `.eml` files for each message.

### Option B: Export via Mozilla Thunderbird (Recommended for Full Mailboxes)
Because Outlook's native `.pst` format is proprietary and closed-source, the most reliable way to convert an Outlook account into `.mbox` without third-party paid tools is via Mozilla Thunderbird:
1. Download and install [Mozilla Thunderbird](https://www.thunderbird.net) (free, open source).
2. Add your Outlook / Microsoft 365 email account via IMAP.
3. Allow Thunderbird to sync your folders.
4. Install the free **ImportExportTools NG** add-on in Thunderbird.
5. Right-click your Outlook folder (e.g. `Inbox`, `Sent`) &rarr; **ImportExportTools NG** &rarr; **Export folder (mbox)**.
6. Save the resulting `.mbox` file to your computer.

---

## 3. How Long Does the Export Take?

- **Direct `.eml` export**: Instant for batches of 50–500 messages.
- **Thunderbird IMAP sync**: 15 to 45 minutes depending on account size and internet connection.

---

## 4. How to Prepare Your Files

1. Collect the exported `.eml` files in a single folder, or locate your exported `.mbox` file.
2. If your files are compressed in a `.zip` archive, extract them before importing.

---

## 5. How to Import into BYOS

1. Open BYOS Webmail (`https://mail.byos.local` or your domain).
2. Open the **Import Emails** modal from the sidebar or settings.
3. Drag your `.eml` files or the `.mbox` archive into the upload drop zone.
4. BYOS analyzes each message:
   - For `.mbox` archives, messages from your own email address are recognized as **Sent** (`→ Sent`).
   - You can also choose a default folder (such as `Inbox` or `Archive`) for any incoming items.
5. Click **Import Emails**.
6. The client streams each email, executes client-side zero-knowledge encryption, and uploads via the 4-worker concurrent queue.

---

## 6. What BYOS Does and Doesn't Import

| Feature | Handled by BYOS Import? | Details |
| :--- | :--- | :--- |
| **Email text, HTML, & attachments** | ✅ Yes | Full MIME structure and attachments preserved. |
| **Sent folder detection** | ✅ Yes | Automatic routing for messages authored by your email address. |
| **Deduplication** | ✅ Yes | Identical messages will not be duplicated. |
| **Outlook Categories / Flags** | ⚠️ Partial | Headers preserved; flags can be reapplied within BYOS. |
| **Outlook Calendar / Contacts** | ❌ No | Mail messages only; contacts and calendar imports use separate vCard/iCal tools. |

---

## 7. Troubleshooting & FAQs

### Can I import a .pst file directly?
BYOS currently accepts `.eml` and `.mbox` files directly in the browser to maintain zero-knowledge encryption safeguards. If you only have a `.pst` file, convert it using Thunderbird or standard open-source tools (`readpst`) before importing.

### What if my connection drops during upload?
BYOS tracks the status of each message. If any messages fail, click **Retry failed (N)** to resume uploading without starting over.
