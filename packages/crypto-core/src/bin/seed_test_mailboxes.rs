use std::error::Error;
use argon2::{
    password_hash::{PasswordHasher, SaltString, rand_core::OsRng},
    Algorithm, Argon2, Params, Version,
};
use byos_crypto_core::{
    derive_signing_key, derive_xwing_seed, generate_x25519_keypair,
    wrap_mailbox_key, wrap_recovery_principal_key, wrap_signing_seed, wrap_xwing_seed,
    xwing,
};

struct MailboxSeed {
    mailbox_id: String,
    user_id: String,
    local_part: String,
    domain: String,
    mailbox_pk_hex: String,
    xwing_pk_hex: String,
    signing_pk_hex: String,
    root_wrapped_mb_hex: String,
    wrapped_sk_user_json: String,
}

fn derive_mailbox(
    mailbox_id: &str,
    user_id: &str,
    local_part: &str,
    domain: &str,
    recovery_root: &[u8; 32],
    password: &str,
) -> Result<MailboxSeed, Box<dyn Error>> {
    let id_hex = mailbox_id.replace('-', "");
    let id_bytes_vec = hex::decode(&id_hex)?;
    if id_bytes_vec.len() != 16 {
        return Err(format!("mailbox_id {} must decode to 16 bytes", mailbox_id).into());
    }
    let mut id_bytes = [0u8; 16];
    id_bytes.copy_from_slice(&id_bytes_vec);

    // 1. X25519 mailbox key
    let (mailbox_sk, mailbox_pk) = generate_x25519_keypair();

    // 2. Ed25519 signing key
    let signing_key = derive_signing_key(recovery_root, &id_bytes, 1)?;
    let signing_seed = signing_key.to_bytes();
    let signing_pk = signing_key.verifying_key().to_bytes();

    // 3. X-Wing seed
    let xwing_seed = derive_xwing_seed(recovery_root, &id_bytes, 1)?;
    let xwing_pk = xwing::public_key_from_seed(&xwing_seed)?;

    // 4. Wrap under password (Argon2id + AES-GCM)
    let mut mb_salt = [0u8; 16];
    rand::fill(&mut mb_salt);
    let mb_env = wrap_recovery_principal_key(password, &mb_salt, &mailbox_sk)?;

    let mut s_salt = [0u8; 16];
    rand::fill(&mut s_salt);
    let s_env = wrap_recovery_principal_key(password, &s_salt, &signing_seed)?;

    let mut x_salt = [0u8; 16];
    rand::fill(&mut x_salt);
    let x_env = wrap_recovery_principal_key(password, &x_salt, &xwing_seed)?;

    // 5. Wrap under recovery root (AES-GCM)
    let mb_root = wrap_mailbox_key(recovery_root, &mailbox_sk, &id_bytes)?;
    let s_root = wrap_signing_seed(recovery_root, &signing_seed, &id_bytes)?;
    let x_root = wrap_xwing_seed(recovery_root, &xwing_seed, &id_bytes)?;

    // 6. Build wrapped_sk_user JSON with HEX fields
    let payload = serde_json::json!({
        "salt": hex::encode(mb_salt),
        "envelope": hex::encode(&mb_env),
        "root_wrapped": hex::encode(&mb_root),
        "signing_salt": hex::encode(s_salt),
        "signing_envelope": hex::encode(&s_env),
        "signing_root_wrapped": hex::encode(&s_root),
        "xwing_salt": hex::encode(x_salt),
        "xwing_envelope": hex::encode(&x_env),
        "xwing_root_wrapped": hex::encode(&x_root),
    });

    Ok(MailboxSeed {
        mailbox_id: mailbox_id.to_string(),
        user_id: user_id.to_string(),
        local_part: local_part.to_string(),
        domain: domain.to_string(),
        mailbox_pk_hex: hex::encode(&mailbox_pk),
        xwing_pk_hex: hex::encode(&xwing_pk),
        signing_pk_hex: hex::encode(&signing_pk),
        root_wrapped_mb_hex: hex::encode(&mb_root),
        wrapped_sk_user_json: payload.to_string(),
    })
}

fn hash_password(password: &str) -> Result<String, Box<dyn Error>> {
    let params = Params::new(65536, 3, 2, Some(32)).map_err(|e| format!("{:?}", e))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let salt = SaltString::generate(&mut OsRng);
    let hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| format!("{:?}", e))?
        .to_string();
    Ok(hash)
}

fn print_sql(
    mailboxes: &[MailboxSeed],
    password: &str,
    domain: &str,
    org_id: &str,
    domain_id: &str,
) -> Result<(), Box<dyn Error>> {
    let password_hash = hash_password(password)?;

    println!("BEGIN;");
    println!();
    println!("-- 1. Ensure Organization exists (org_recovery_pk is NOT NULL)");
    println!(
        "INSERT INTO organizations (id, name, org_recovery_pk)\nVALUES ('{}'::uuid, 'Smoke Test Org', '\\x00'::bytea)\nON CONFLICT (id) DO NOTHING;",
        org_id
    );
    println!();
    println!("-- 2. Ensure Domain exists (upsert by name)");
    println!(
        "INSERT INTO domains (id, org_id, name, is_verified)\nVALUES (\n  '{}'::uuid,\n  '{}'::uuid,\n  '{}',\n  true\n)\nON CONFLICT (name) DO UPDATE SET is_verified = true;",
        domain_id, org_id, domain
    );
    println!();

    // Cleanup child tables, mailboxes, and users
    println!("-- 3. Cleanup prior mailboxes and child records for idempotency");
    let id_list = mailboxes
        .iter()
        .map(|m| format!("'{}'::uuid", m.mailbox_id))
        .collect::<Vec<_>>()
        .join(", ");
    let local_list = mailboxes
        .iter()
        .map(|m| format!("'{}'", m.local_part))
        .collect::<Vec<_>>()
        .join(", ");
    let user_id_list = mailboxes
        .iter()
        .map(|m| format!("'{}'::uuid", m.user_id))
        .collect::<Vec<_>>()
        .join(", ");
    let user_email_list = mailboxes
        .iter()
        .map(|m| format!("'{}@{}'", m.local_part, m.domain))
        .collect::<Vec<_>>()
        .join(", ");

    let target_mb = format!(
        "SELECT id FROM mailboxes WHERE id IN ({}) OR (domain_id = (SELECT id FROM domains WHERE name = '{}') AND local_part IN ({}))",
        id_list, domain, local_list
    );
    let target_users = format!(
        "SELECT id FROM users WHERE id IN ({}) OR email IN ({})",
        user_id_list, user_email_list
    );

    println!("DELETE FROM scheduled_messages WHERE mailbox_id IN ({});", target_mb);
    println!("DELETE FROM delivery_log WHERE mailbox_id IN ({});", target_mb);
    println!("DELETE FROM outbound_queue WHERE mailbox_id IN ({});", target_mb);
    println!("DELETE FROM outbound_reservations WHERE mailbox_id IN ({});", target_mb);
    println!("DELETE FROM message_labels WHERE message_id IN (SELECT id FROM message_metadata WHERE mailbox_id IN ({}));", target_mb);
    println!("DELETE FROM attachments WHERE mailbox_id IN ({});", target_mb);
    println!("DELETE FROM message_tracking WHERE mailbox_id IN ({});", target_mb);
    println!("DELETE FROM message_metadata WHERE mailbox_id IN ({});", target_mb);
    println!("DELETE FROM drafts WHERE mailbox_id IN ({});", target_mb);
    println!("DELETE FROM mailbox_storage WHERE mailbox_id IN ({});", target_mb);
    println!("DELETE FROM search_index WHERE mailbox_id IN ({});", target_mb);
    println!("DELETE FROM search_tokens WHERE mailbox_id IN ({});", target_mb);
    println!("DELETE FROM auto_reply_rules WHERE mailbox_id IN ({});", target_mb);
    println!("DELETE FROM mailbox_address_rules WHERE mailbox_id IN ({});", target_mb);
    println!("DELETE FROM mail_rules WHERE mailbox_id IN ({});", target_mb);
    println!("DELETE FROM device_mailbox_access WHERE mailbox_id IN ({});", target_mb);
    println!("DELETE FROM storage_connections WHERE mailbox_id IN ({});", target_mb);
    println!("DELETE FROM bridge_credentials WHERE mailbox_id IN ({});", target_mb);
    println!("DELETE FROM account_invitations WHERE mailbox_id IN ({});", target_mb);
    println!("DELETE FROM mailbox_folders WHERE mailbox_id IN ({});", target_mb);
    println!("DELETE FROM mailbox_labels WHERE mailbox_id IN ({});", target_mb);
    println!("DELETE FROM aliases WHERE mailbox_id IN ({});", target_mb);
    println!("DELETE FROM contacts WHERE mailbox_id IN ({});", target_mb);
    println!("DELETE FROM mailbox_settings WHERE mailbox_id IN ({});", target_mb);
    println!(
        "DELETE FROM mailboxes\nWHERE id IN ({})\n   OR (domain_id = (SELECT id FROM domains WHERE name = '{}') AND local_part IN ({}));",
        id_list, domain, local_list
    );
    println!("DELETE FROM sessions WHERE user_id IN ({});", target_users);
    println!("DELETE FROM user_passkeys WHERE user_id IN ({});", target_users);
    println!("DELETE FROM auth_challenges WHERE user_id IN ({});", target_users);
    println!("DELETE FROM recovery_challenges WHERE user_id IN ({});", target_users);
    println!("DELETE FROM devices WHERE user_id IN ({});", target_users);
    println!("DELETE FROM org_recovery_principals WHERE user_id IN ({});", target_users);
    println!("DELETE FROM google_drive_oauth_states WHERE user_id IN ({});", target_users);
    println!("DELETE FROM audit_log WHERE user_id IN ({});", target_users);
    println!("DELETE FROM users WHERE id IN ({}) OR email IN ({});", user_id_list, user_email_list);
    println!();

    // Users and mailboxes
    for mb in mailboxes {
        println!("-- User: {}@{}", mb.local_part, mb.domain);
        println!(
            "INSERT INTO users (id, org_id, email, password_hash, is_active, role, two_factor_enabled)\nVALUES (\n  '{}'::uuid,\n  (SELECT org_id FROM domains WHERE name = '{}'),\n  '{}@{}',\n  '{}',\n  true,\n  'owner',\n  false\n)\nON CONFLICT (id) DO UPDATE SET\n  password_hash = EXCLUDED.password_hash,\n  two_factor_enabled = false,\n  is_active = true;",
            mb.user_id, mb.domain, mb.local_part, mb.domain, password_hash
        );
        println!();

        println!("-- Mailbox: {}@{}", mb.local_part, mb.domain);
        let escaped_json = mb.wrapped_sk_user_json.replace('\'', "''");
        println!(
            "INSERT INTO mailboxes (\n  id, user_id, domain_id, org_id, local_part, is_active, key_status,\n  mailbox_pk, mailbox_xwing_pk, mailbox_ed25519_pk,\n  mailbox_sk_wrapped, wrapped_sk_user,\n  key_epoch, signing_key_epoch, mailbox_sk_version\n) VALUES (\n  '{}'::uuid,\n  '{}'::uuid,\n  (SELECT id FROM domains WHERE name = '{}'),\n  (SELECT org_id FROM domains WHERE name = '{}'),\n  '{}',\n  true,\n  'active',\n  decode('{}', 'hex'),\n  decode('{}', 'hex'),\n  decode('{}', 'hex'),\n  decode('{}', 'hex'),\n  '{}',\n  1, 1, 1\n);",
            mb.mailbox_id,
            mb.user_id,
            mb.domain,
            mb.domain,
            mb.local_part,
            mb.mailbox_pk_hex,
            mb.xwing_pk_hex,
            mb.signing_pk_hex,
            mb.root_wrapped_mb_hex,
            escaped_json
        );
        println!();

    }

    println!("COMMIT;");
    Ok(())
}

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = std::env::args().collect();

    let mut is_pair = false;
    let mut password = "test-password-123".to_string();
    let mut domain = "byos.local".to_string();
    let mut local_part = "alice".to_string();
    let mut mailbox_id = "c0000000-0000-0000-0000-000000000001".to_string();
    let mut recovery_root_hex: Option<String> = None;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--pair" => {
                is_pair = true;
                i += 1;
            }
            "--password" => {
                if i + 1 < args.len() {
                    password = args[i + 1].clone();
                    i += 2;
                } else {
                    return Err("--password requires an argument".into());
                }
            }
            "--domain" => {
                if i + 1 < args.len() {
                    domain = args[i + 1].clone();
                    i += 2;
                } else {
                    return Err("--domain requires an argument".into());
                }
            }
            "--local-part" => {
                if i + 1 < args.len() {
                    local_part = args[i + 1].clone();
                    i += 2;
                } else {
                    return Err("--local-part requires an argument".into());
                }
            }
            "--mailbox-id" => {
                if i + 1 < args.len() {
                    mailbox_id = args[i + 1].clone();
                    i += 2;
                } else {
                    return Err("--mailbox-id requires an argument".into());
                }
            }
            "--recovery-root-hex" => {
                if i + 1 < args.len() {
                    recovery_root_hex = Some(args[i + 1].clone());
                    i += 2;
                } else {
                    return Err("--recovery-root-hex requires an argument".into());
                }
            }
            "-h" | "--help" => {
                eprintln!(
                    "Usage: seed-test-mailboxes [--pair] [--password <pw>] [--domain <domain>] [--local-part <name>] [--mailbox-id <uuid>] [--recovery-root-hex <hex>]"
                );
                return Ok(());
            }
            other => {
                return Err(format!("Unknown argument: {}", other).into());
            }
        }
    }

    let org_id = "00000000-0000-0000-0000-000000000aaa";
    let domain_id = "00000000-0000-0000-0000-000000000bbb";

    let mut mailboxes = Vec::new();

    if is_pair {
        // IMPORTANT: These UUIDs must not collide with any UUID used by the 
        // services/api test suite. The test suite performs cleanup DELETEs on 
        // its own fixtures. If the seed tool uses the same IDs, running tests 
        // will wipe the dev environment.

        // Alice
        let mut alice_root = [0u8; 32];
        alice_root[31] = 0x01;
        mailboxes.push(derive_mailbox(
            "c0000000-0000-0000-0000-000000000001",
            "cccccccc-0000-0000-0000-000000000002",
            "alice",
            &domain,
            &alice_root,
            &password,
        )?);

        // Bob
        let mut bob_root = [0u8; 32];
        bob_root[31] = 0x02;
        mailboxes.push(derive_mailbox(
            "c0000000-0000-0000-0000-000000000002",
            "cccccccc-0000-0000-0000-000000000003",
            "bob",
            &domain,
            &bob_root,
            &password,
        )?);
    } else {
        let root = if let Some(hex_str) = recovery_root_hex {
            let bytes = hex::decode(&hex_str)?;
            let mut arr = [0u8; 32];
            arr.copy_from_slice(&bytes);
            arr
        } else {
            let mut arr = [0u8; 32];
            rand::fill(&mut arr);
            arr
        };

        let user_id = "cccccccc-0000-0000-0000-000000000002";
        mailboxes.push(derive_mailbox(
            &mailbox_id,
            user_id,
            &local_part,
            &domain,
            &root,
            &password,
        )?);
    }

    print_sql(&mailboxes, &password, &domain, org_id, domain_id)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_format_matches_server_expectation() {
        let hash = hash_password("test-password-123").unwrap();
        let parts: Vec<&str> = hash.split('$').collect();
        assert_eq!(
            parts.len(),
            6,
            "expected 6 parts, got {}: {}",
            parts.len(),
            hash
        );
        assert_eq!(parts[1], "argon2id");
        assert_eq!(parts[2], "v=19");
        println!("Hash: {}", hash);
    }
}
