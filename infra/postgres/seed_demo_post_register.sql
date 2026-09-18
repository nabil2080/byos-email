DO $$
DECLARE
    v_org_id uuid;
    v_user_id uuid;
    v_domain_id uuid := 'd0d0d0d0-d0d0-d0d0-d0d0-d0d0d0d0d0d0';
    v_storage_conn_id uuid := 'd0a3f3c1-4b5e-4f6a-8c7d-9e0f1a2b3c4d';
BEGIN
    -- Look up the org and user
    SELECT org_id, id INTO v_org_id, v_user_id
    FROM users
    WHERE email = 'admin@demo.local'
    LIMIT 1;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'User admin@demo.local not found!';
    END IF;

    -- 1. Insert domain
    INSERT INTO domains (id, org_id, name, is_verified, dkim_selector, dkim_private_key_enc, dkim_public_key)
    VALUES (v_domain_id, v_org_id, 'demo.local', true, 'byos', decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'), 'v=DKIM1; k=rsa; p=dummy')
    ON CONFLICT (name) DO UPDATE SET is_verified = true;

    -- 2. Insert active storage connection for org
    INSERT INTO storage_connections (id, org_id, provider, provider_type, bucket_name, endpoint, credentials_enc, status, is_active)
    VALUES (v_storage_conn_id, v_org_id, 'minio', 'minio', 'byos-mailbox', 'minio:9000', decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'), 'active', true)
    ON CONFLICT (id) DO UPDATE SET status = 'active';

END $$;
