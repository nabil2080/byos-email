# Amazon SES Outbound Relay Configuration

This guide details configuring Postfix to relay outbound mail through Amazon SES (Simple Email Service).

---

## 1. Prerequisites

- Active AWS account with permissions to manage Amazon SES and Route 53 (or external DNS provider).
- Verified sending domain (e.g., `byos.local` or your production domain). In SES sandbox mode, both sender and recipient addresses must be individually verified in SES.

---

## 2. Requesting SES Production Access

New AWS accounts begin in the SES sandbox:
1. Navigate to the **Amazon SES Console** -> **Account dashboard**.
2. Click **Request production access**.
3. Specify:
   - Mail type: Transactional / System notifications.
   - Website URL: Your application domain.
   - Use case description: System and transactional user outbound mail for BYOS email platform.
   - Compliance acknowledgments (bounce/complaint handling).
4. Review typically takes 24-48 hours.

---

## 3. Verifying Sending Domain (DKIM)

1. Navigate to **Amazon SES** -> **Configuration** -> **Identities**.
2. Click **Create identity** -> select **Domain**.
3. Enter your domain name (e.g. `example.com`).
4. Select **Easy DKIM** (RSA 2048-bit recommended).
5. Publish the three CNAME records provided by AWS into your DNS provider.
6. Wait for SES status to transition from `Pending` to `Verified`.

---

## 4. Creating SMTP Credentials in SES Console

SES requires dedicated SMTP credentials (these are IAM credentials with restricted SES send permissions, distinct from regular IAM secret access keys):
1. Navigate to **Amazon SES** -> **Account dashboard** -> **SMTP settings**.
2. Note the **SMTP endpoint** (e.g., `email-smtp.us-east-1.amazonaws.com`) and port (`587`).
3. Click **Create SMTP credentials**.
4. Specify an IAM user name (e.g., `ses-smtp-byos-outbound`) and click **Create user**.
5. Copy the generated **SMTP Username** and **SMTP Password**.

---

## 5. Formatting Credentials File for Postfix

Create or edit `infra/secrets/ses_smtp_credentials.txt` (gitignored):

```text
[email-smtp.<region>.amazonaws.com]:587 <SMTP_USERNAME>:<SMTP_PASSWORD>
```

Example for `us-east-1`:
```text
[email-smtp.us-east-1.amazonaws.com]:587 AKIAIOSFODNN7EXAMPLE:wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

File permissions must be restricted:
```bash
chmod 600 infra/secrets/ses_smtp_credentials.txt
```

---

## 6. Setting `POSTFIX_RELAYHOST` for Target Region

Configure the environment variable matching your SES region and endpoint port:

### In `.env` or Shell
```bash
POSTFIX_RELAYHOST=[email-smtp.us-east-1.amazonaws.com]:587
```

In PowerShell:
```powershell
$env:POSTFIX_RELAYHOST="[email-smtp.us-east-1.amazonaws.com]:587"
```

When Postfix starts up, `infra/postfix/init/10-byos-routing.sh` automatically detects the `email-smtp` / `amazonaws.com` host, parses `/run/secrets/ses_smtp_credentials`, generates `/etc/postfix/sasl_passwd.db`, and enables mandatory TLS (`smtp_tls_security_level = encrypt`) and SASL authentication.

---

## 7. Testing Delivery

1. Start the stack:
   ```bash
   docker compose -f infra/docker-compose.yml up -d
   ```
2. Verify Postfix logs confirm SES configuration:
   ```bash
   docker logs byos-postfix | grep SES
   ```
   Expected output:
   ```text
   Configuring Postfix relayhost: [email-smtp.us-east-1.amazonaws.com]:587
   SES relay mode detected ([email-smtp.us-east-1.amazonaws.com]:587)
   SES SASL credentials and TLS encryption configured
   ```
3. Submit a test message to an external recipient via the outbound queue or API.
4. Verify Postfix outbound delivery log:
   ```bash
   docker logs byos-postfix --tail 20
   ```
   Confirm `relay=email-smtp.us-east-1.amazonaws.com[...]:587` with `status=sent (250 Ok ...)`.
