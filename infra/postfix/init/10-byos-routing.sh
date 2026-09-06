#!/bin/sh

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