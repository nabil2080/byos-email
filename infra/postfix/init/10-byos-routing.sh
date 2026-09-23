#!/bin/sh
set -e

# Postfix configuration for OUTBOUND ONLY
# Inbound mail is handled by dedicated inbound-bridge service

cat > /etc/postfix/byos_transport <<'MAP'
# Outbound transport maps only
MAP

postmap lmdb:/etc/postfix/byos_transport
postconf -e 'transport_maps = lmdb:/etc/postfix/byos_transport'
postconf -e 'mydestination = localhost, localhost.localdomain, byos.local'
postconf -e 'relay_domains ='
postconf -e 'local_recipient_maps ='
postconf -e 'smtpd_recipient_restrictions = permit_mynetworks, reject_unauth_destination'
# No milters for inbound - Rspamd is now a standalone service called by inbound-bridge
postconf -e 'smtpd_milters ='
postconf -e 'non_smtpd_milters ='
postconf -e 'milter_default_action = accept'
postconf -e 'milter_protocol = 6'

# Outbound submission configuration
postconf -e 'submission_sasl_auth_enable = yes'
postconf -e 'submission_sasl_security_options = noanonymous'
postconf -e 'submission_sasl_type = dovecot'
postconf -e 'submission_sasl_path = private/auth'

# Configurable outbound relay: Direct MX (default), Mailpit, or SES
if [ -n "$POSTFIX_RELAYHOST" ]; then
    echo "Configuring Postfix relayhost: $POSTFIX_RELAYHOST"
    postconf -e "relayhost = $POSTFIX_RELAYHOST"

    case "$POSTFIX_RELAYHOST" in
        *email-smtp*|*amazonaws.com*)
            echo "SES relay mode detected ($POSTFIX_RELAYHOST)"
            CREDS_FILE="/run/secrets/ses_smtp_credentials"
            if [ ! -f "$CREDS_FILE" ] || [ ! -s "$CREDS_FILE" ]; then
                echo "FATAL: SES relay configured ($POSTFIX_RELAYHOST) but credentials secret $CREDS_FILE not found or empty." >&2
                exit 1
            fi
            cp "$CREDS_FILE" /etc/postfix/sasl_passwd
            chmod 600 /etc/postfix/sasl_passwd
            postmap hash:/etc/postfix/sasl_passwd
            postconf -e 'smtp_sasl_auth_enable = yes'
            postconf -e 'smtp_sasl_password_maps = hash:/etc/postfix/sasl_passwd'
            postconf -e 'smtp_sasl_security_options = noanonymous'
            postconf -e 'smtp_tls_security_level = encrypt'
            echo "SES SASL credentials and TLS encryption configured"
            ;;
        *)
            echo "Relay mode configured without SASL (e.g. Mailpit/local catcher)"
            ;;
    esac
else
    echo "No POSTFIX_RELAYHOST set; using direct MX delivery via DNS"
    postconf -e 'relayhost ='
fi