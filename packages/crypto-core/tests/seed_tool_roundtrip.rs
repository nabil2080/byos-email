use byos_crypto_core::{
    derive_signing_key, derive_xwing_seed, generate_x25519_keypair,
    unwrap_mailbox_key, unwrap_recovery_principal_key, unwrap_signing_seed, unwrap_xwing_seed,
    wrap_mailbox_key, wrap_recovery_principal_key, wrap_signing_seed, wrap_xwing_seed,
    xwing,
};

#[test]
fn seed_tool_produces_unwrappable_payload() {
    // 1. Replicate derivation with fixed inputs
    let mailbox_id_hex = "a0000000000000000000000000000001";
    let id_bytes: [u8; 16] = hex::decode(mailbox_id_hex).unwrap().try_into().unwrap();
    let mut root = [0u8; 32];
    root[31] = 1;
    let password = "test-password-123";

    // 2. Derive seeds and keys
    let (mailbox_sk, _mailbox_pk) = generate_x25519_keypair();
    let signing_key = derive_signing_key(&root, &id_bytes, 1).unwrap();
    let signing_seed = signing_key.to_bytes();
    let signing_pk = signing_key.verifying_key().to_bytes();

    let xwing_seed = derive_xwing_seed(&root, &id_bytes, 1).unwrap();
    let xwing_pk = xwing::public_key_from_seed(&xwing_seed).unwrap();
    assert_eq!(xwing_pk.len(), 1216);
    assert_eq!(signing_pk.len(), 32);

    // 3. Wrap all three under password (Argon2id + AES-GCM)
    let mut mb_salt = [0u8; 16];
    rand::fill(&mut mb_salt);
    let mb_env = wrap_recovery_principal_key(password, &mb_salt, &mailbox_sk).unwrap();

    let mut s_salt = [0u8; 16];
    rand::fill(&mut s_salt);
    let s_env = wrap_recovery_principal_key(password, &s_salt, &signing_seed).unwrap();

    let mut x_salt = [0u8; 16];
    rand::fill(&mut x_salt);
    let x_env = wrap_recovery_principal_key(password, &x_salt, &xwing_seed).unwrap();

    // 4. Wrap under recovery root (AES-GCM)
    let mb_root = wrap_mailbox_key(&root, &mailbox_sk, &id_bytes).unwrap();
    let s_root = wrap_signing_seed(&root, &signing_seed, &id_bytes).unwrap();
    let x_root = wrap_xwing_seed(&root, &xwing_seed, &id_bytes).unwrap();

    // 5. Build wrapped_sk_user JSON
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
    let payload_str = payload.to_string();

    // 6. Parse JSON back and verify unwrap of all three secrets
    let parsed: serde_json::Value = serde_json::from_str(&payload_str).unwrap();

    // 6a. Password unwrap
    let parsed_mb_salt: [u8; 16] = hex::decode(parsed["salt"].as_str().unwrap())
        .unwrap()
        .try_into()
        .unwrap();
    let parsed_mb_env = hex::decode(parsed["envelope"].as_str().unwrap()).unwrap();
    let unwrapped_mb_sk = unwrap_recovery_principal_key(password, &parsed_mb_salt, &parsed_mb_env).unwrap();
    assert_eq!(unwrapped_mb_sk, mailbox_sk);

    let parsed_s_salt: [u8; 16] = hex::decode(parsed["signing_salt"].as_str().unwrap())
        .unwrap()
        .try_into()
        .unwrap();
    let parsed_s_env = hex::decode(parsed["signing_envelope"].as_str().unwrap()).unwrap();
    let unwrapped_signing_seed = unwrap_recovery_principal_key(password, &parsed_s_salt, &parsed_s_env).unwrap();
    assert_eq!(unwrapped_signing_seed, signing_seed);

    let parsed_x_salt: [u8; 16] = hex::decode(parsed["xwing_salt"].as_str().unwrap())
        .unwrap()
        .try_into()
        .unwrap();
    let parsed_x_env = hex::decode(parsed["xwing_envelope"].as_str().unwrap()).unwrap();
    let unwrapped_xwing_seed = unwrap_recovery_principal_key(password, &parsed_x_salt, &parsed_x_env).unwrap();
    assert_eq!(unwrapped_xwing_seed, xwing_seed);

    // 6b. Recovery root unwrap
    let parsed_mb_root = hex::decode(parsed["root_wrapped"].as_str().unwrap()).unwrap();
    let root_unwrapped_mb = unwrap_mailbox_key(&root, &parsed_mb_root, &id_bytes).unwrap();
    assert_eq!(root_unwrapped_mb, mailbox_sk);

    let parsed_s_root = hex::decode(parsed["signing_root_wrapped"].as_str().unwrap()).unwrap();
    let root_unwrapped_s = unwrap_signing_seed(&root, &parsed_s_root, &id_bytes).unwrap();
    assert_eq!(root_unwrapped_s, signing_seed);

    let parsed_x_root = hex::decode(parsed["xwing_root_wrapped"].as_str().unwrap()).unwrap();
    let root_unwrapped_x = unwrap_xwing_seed(&root, &parsed_x_root, &id_bytes).unwrap();
    assert_eq!(root_unwrapped_x, xwing_seed);
}
