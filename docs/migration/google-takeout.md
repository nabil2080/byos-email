# Migrating from Gmail via Google Takeout

This guide walks you through exporting your email history from Gmail using Google Takeout and importing it directly into BYOS Email with client-side zero-knowledge encryption.

---

## 1. What is Google Takeout?

Google Takeout is Google's official data portability tool. It enables you to export an archive of all or selected Google services, including your entire Gmail history, formatted as standard `.mbox` archive files.

When you export Gmail via Takeout:
- Every email is stored in RFC 822 / RFC 5322 format.
- Gmail embeds your original folder names, categories, and tags inside an `X-Gmail-Labels` header (e.g., `Inbox`, `Sent`, `Archive`, `Spam`, `Trash`).
- Attachments, headers, timestamps, and message bodies are completely preserved.

---

## 2. How to Export Gmail as .mbox (Step-by-Step)

Follow these exact steps:

1. Open your browser and navigate to [https://takeout.google.com](https://takeout.google.com).
2. Sign in with the Google Account you wish to migrate.
3. At the top of the **Create a new export** section, click **Deselect all** (to avoid downloading YouTube videos, Google Drive files, or Maps data).
4. Scroll down through the list until you find **Mail**. Check the box next to **Mail**.
5. *(Optional)* Click **All Mail data included** if you wish to export specific labels rather than your entire mailbox history.
6. Scroll to the bottom of the page and click **Next step**.
7. In the **Choose file type, frequency & destination** step:
   - **Destination**: Choose *"Transfer to email"* (or *"Send download link via email"*).
   - **Frequency**: Select *"Export once"*.
   - **File type**: Select **`.zip`**.
   - **File size**: We recommend selecting **10 GB** or **50 GB** so your mail is not split across multiple small zip archives.
8. Click **Create export**.

---

## 3. How Long Does the Export Take?

- **Small accounts (< 2 GB)**: Typically completes within 30 to 60 minutes.
- **Medium accounts (2–10 GB)**: Usually takes 2 to 6 hours.
- **Large accounts (> 20 GB)**: Can take up to 24 to 48 hours.

Google processes exports asynchronously on their servers. You do not need to keep the browser tab open. Google will send an email to your recovery or primary address titled *"Your Google data is ready to download"* when the archive is complete.

---

## 4. How to Download and Unzip the Archive

1. Open the notification email from Google and click **Download your files** (or return to [takeout.google.com](https://takeout.google.com) and visit **Manage exports**).
2. You will be prompted to re-authenticate with your Google password.
3. Save the downloaded `.zip` file to your computer.
4. Extract (unzip) the file:
   - **Windows**: Right-click the `.zip` file and select **Extract All...**.
   - **macOS**: Double-click the `.zip` file in Finder.
   - **Linux**: Run `unzip takeout-*.zip`.
5. Open the extracted folder and navigate to:
   ```
   Takeout/
   └── Mail/
       └── All mail Including Spam and Trash.mbox
   ```
   *(Or individual label `.mbox` files if you selected specific labels during export).*

---

## 5. How to Import into BYOS

1. Log in to the BYOS Webmail application (`https://mail.byos.local` or your organization's domain).
2. Click the **Import** button in the sidebar or settings drawer.
3. Drag and drop the `All mail Including Spam and Trash.mbox` file onto the drop zone (or click to browse and select it).
4. Review the staged messages. BYOS automatically detects Gmail labels:
   - Messages labeled `Sent` are mapped to **Sent** (`→ Sent`).
   - Messages labeled `Trash` or `Spam` are routed to **Trash** and **Spam**.
   - Messages labeled `Archive` (or lacking `Inbox`) are routed to **Archive**.
   - Messages labeled `Inbox` are placed in **Inbox**.
5. Select whether to mark imported emails as read.
6. Click **Import Emails**.
7. The importer will stream messages, encrypt each one locally with your mailbox's post-quantum X-Wing key, and upload them concurrently.

---

## 6. What BYOS Does and Doesn't Import

| Feature | Handled by BYOS Import? | Details |
| :--- | :--- | :--- |
| **Email bodies (Text & HTML)** | ✅ Yes | Full formatting, inline styles, and alternate parts preserved. |
| **Attachments** | ✅ Yes | Encrypted and stored zero-knowledge with file metadata intact. |
| **Headers & Timestamps** | ✅ Yes | Original `Date`, `From`, `To`, `Cc`, `Message-ID`, and thread headers preserved. |
| **Gmail Labels** | ✅ Yes (Folder mapping) | Mapped to BYOS folders (`Sent`, `Inbox`, `Archive`, `Spam`, `Trash`). |
| **Deduplication** | ✅ Yes | Re-importing the same archive skips already imported messages without duplicating. |
| **Gmail Starred / Snoozed** | ⚠️ Partial | Starred state can be managed after import; snoozed schedules are reset. |
| **Gmail Filters / Rules** | ❌ No | Automated filters must be configured separately in BYOS settings. |

---

## 7. Troubleshooting & FAQs

### What if my browser tab accidentally closes or refreshes?
The BYOS importer includes tab-unload protection and will prompt you before closing if an import is running. If closed unexpectedly, simply re-select the `.mbox` file and click Import. BYOS deduplicates each message by its unique cryptographic delivery identity—already imported messages will be safely marked as "Already exists" without duplicates or extra charges.

### What if some messages fail with an "Error" status?
If a network hiccup or temporary server timeout occurs, click the **Retry failed (N)** button. BYOS will retry only the failed messages using the concurrent worker pool.

### Can I import an archive larger than 1 GB?
Yes! BYOS uses a streaming parser (`streamMbox`) with 64KB chunk processing. It never loads the whole archive into memory, allowing you to import multi-gigabyte mailboxes smoothly without browser tab crashes.
