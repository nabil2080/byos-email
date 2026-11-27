TRUNCATE TABLE delivery_operator_idempotency, outbound_delivery_operator_audit, outbound_queue, delivery_log CASCADE;

INSERT INTO outbound_queue (
    id, delivery_id, mailbox_id, domain_id, recipient,
    encrypted_message, send_token_hpke_wrapped, status,
    attempts, max_attempts, created_at, next_attempt_at, expires_at,
    smtp_phase, last_error
) VALUES (
    'e5000000-0000-0000-0000-000000000001',
    'd5000000-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000bbb',
    'dave.investigation@target.net',
    '\x01020304', '\x05060708',
    'outcome_unknown',
    2, 5,
    clock_timestamp() - interval '45 minutes',
    clock_timestamp() - interval '40 minutes',
    clock_timestamp() + interval '23 hours',
    'terminator_in_flight',
    'connection dropped after sending data terminator'
);

INSERT INTO delivery_log (
    delivery_id, mailbox_id, domain_id, recipient, direction,
    status, smtp_code, smtp_message, created_at, smtp_phase
) VALUES
    ('d5000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000bbb', 'dave.investigation@target.net', 'outbound', 'retrying', 451, '451 4.4.2 Timeout waiting for reply', clock_timestamp() - interval '45 minutes', 'pre_data'),
    ('d5000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000bbb', 'dave.investigation@target.net', 'outbound', 'outcome_unknown', 0, 'Connection dropped during terminator transmission', clock_timestamp() - interval '40 minutes', 'terminator_in_flight');

INSERT INTO outbound_queue (
    id, delivery_id, mailbox_id, domain_id, recipient,
    encrypted_message, send_token_hpke_wrapped, status,
    attempts, max_attempts, created_at, next_attempt_at, expires_at,
    smtp_phase, last_error
) VALUES (
    'e5000000-0000-0000-0000-000000000002',
    'd5000000-0000-0000-0000-000000000002',
    'c0000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000bbb',
    'eve.reconcile@secure.io',
    '\x01020304', '\x05060708',
    'outcome_unknown',
    1, 5,
    clock_timestamp() - interval '2 hours',
    clock_timestamp() - interval '1 hour',
    clock_timestamp() + interval '22 hours',
    'terminator_in_flight',
    'socket timeout waiting for 250 response'
);

INSERT INTO outbound_queue (
    id, delivery_id, mailbox_id, domain_id, recipient,
    encrypted_message, send_token_hpke_wrapped, status,
    attempts, max_attempts, created_at, next_attempt_at, expires_at,
    lease_token, lease_owner, claimed_at, lease_expires_at,
    smtp_phase
) VALUES (
    'e5000000-0000-0000-0000-000000000003',
    'd5000000-0000-0000-0000-000000000003',
    'c0000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000bbb',
    'carol.partner@enterprise.org',
    '\x01020304', '\x05060708',
    'processing',
    1, 5,
    clock_timestamp() - interval '2 minutes',
    clock_timestamp() - interval '1 minute',
    clock_timestamp() + interval '24 hours',
    '15000000-0000-0000-0000-000000000001',
    'worker-pod-3',
    clock_timestamp() - interval '1 minute',
    clock_timestamp() + interval '5 minutes',
    'data_streaming'
);

INSERT INTO outbound_queue (
    id, delivery_id, mailbox_id, domain_id, recipient,
    encrypted_message, send_token_hpke_wrapped, status,
    attempts, max_attempts, created_at, next_attempt_at, expires_at
) VALUES (
    'e5000000-0000-0000-0000-000000000004',
    'd5000000-0000-0000-0000-000000000004',
    'c0000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000bbb',
    'bob.pending@local.dev',
    '\x01020304', '\x05060708',
    'pending',
    0, 5,
    clock_timestamp() - interval '5 minutes',
    clock_timestamp() - interval '2 minutes',
    clock_timestamp() + interval '24 hours'
);

INSERT INTO outbound_queue (
    id, delivery_id, mailbox_id, domain_id, recipient,
    encrypted_message, send_token_hpke_wrapped, status,
    attempts, max_attempts, created_at, next_attempt_at, expires_at,
    delivered_at
) VALUES (
    'e5000000-0000-0000-0000-000000000005',
    'd5000000-0000-0000-0000-000000000005',
    'c0000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000bbb',
    'charlie.delivered@remote.org',
    '\x01020304', '\x05060708',
    'delivered',
    1, 5,
    clock_timestamp() - interval '3 hours',
    clock_timestamp() - interval '3 hours',
    clock_timestamp() + interval '21 hours',
    clock_timestamp() - interval '3 hours'
);

INSERT INTO outbound_queue (
    id, delivery_id, mailbox_id, domain_id, recipient,
    encrypted_message, send_token_hpke_wrapped, status,
    attempts, max_attempts, created_at, next_attempt_at, expires_at,
    failed_at, last_smtp_code, last_error
) VALUES (
    'e5000000-0000-0000-0000-000000000006',
    'd5000000-0000-0000-0000-000000000006',
    'c0000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000bbb',
    'frank.bounced@badhost.net',
    '\x01020304', '\x05060708',
    'bounced',
    3, 5,
    clock_timestamp() - interval '4 hours',
    clock_timestamp() - interval '4 hours',
    clock_timestamp() + interval '20 hours',
    clock_timestamp() - interval '4 hours',
    550,
    '550 5.1.1 User unknown'
);

INSERT INTO outbound_queue (
    id, delivery_id, mailbox_id, domain_id, recipient,
    encrypted_message, send_token_hpke_wrapped, status,
    attempts, max_attempts, created_at, next_attempt_at, expires_at,
    smtp_phase, last_error
) VALUES (
    'e5000000-0000-0000-0000-000000000007',
    'd5000000-0000-0000-0000-000000000007',
    'c0000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000bbb',
    'alice.accepted@remote.org',
    '\x01020304', '\x05060708',
    'outcome_unknown',
    1, 5,
    clock_timestamp() - interval '1 hour',
    clock_timestamp() - interval '30 minutes',
    clock_timestamp() + interval '23 hours',
    'accepted_by_mta',
    'crash before settlement'
);

INSERT INTO outbound_queue (
    id, delivery_id, mailbox_id, domain_id, recipient,
    encrypted_message, send_token_hpke_wrapped, status,
    attempts, max_attempts, created_at, next_attempt_at, expires_at,
    manual_retry_count, max_manual_retries, last_error
) VALUES (
    'e5000000-0000-0000-0000-000000000008',
    'd5000000-0000-0000-0000-000000000008',
    'c0000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000bbb',
    'grace.exhausted@retrylimit.com',
    '\x01020304', '\x05060708',
    'outcome_unknown',
    3, 5,
    clock_timestamp() - interval '2 hours',
    clock_timestamp() - interval '1 hour',
    clock_timestamp() + interval '22 hours',
    1, 1,
    'retry attempt timed out after previous operator authorization'
);
