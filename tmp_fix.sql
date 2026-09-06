UPDATE mailbox_storage SET storage_connection_id='e0e65570-8f4b-4244-b68c-bd15e31a178c' WHERE mailbox_id='0cb877dc-4206-4408-8709-1eac14129d6a';
UPDATE storage_connections SET config='{"tombstone":true}'::jsonb, encrypted=true, status='deleted', credentials_enc=''::bytea WHERE id='d0a3f3c1-4b5e-4f6a-8c7d-9e0f1a2b3c4d';
UPDATE storage_connections SET status='deleted' WHERE id='bd130898-09a7-4f6f-952b-eb5bfac3e14c';
SELECT id::text, provider, encrypted, status, config::text FROM storage_connections;
