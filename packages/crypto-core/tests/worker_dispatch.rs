use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use byos_crypto_core::{
    decrypt_message_xwing, encrypt_payload, generate_x25519_keypair,
    xwing::public_key_from_seed, EncryptError, EncryptRequest,
};

#[test]
fn test_dispatch_x25519_path() {
    let (_sk, pk) = generate_x25519_keypair();
    let req = EncryptRequest {
        mailbox_id: "eeeeeeee-0000-0000-0000-000000000001".to_string(),
        message_seq: 1,
        mailbox_public_key: BASE64.encode(pk),
        plaintext: BASE64.encode(b"Subject: Test\r\n\r\nHello X25519"),
        storage_object_id: "mailboxes/eeeeeeee-0000-0000-0000-000000000001/00000000000000000001.eml.enc".to_string(),
        mailbox_sk_version: 1,
        mailbox_xwing_public_key: None,
    };

    let output = encrypt_payload(&req).expect("encrypt X25519 payload");
    assert_eq!(output.wrapped_key_algorithm, "HPKE-X25519-AES256GCM-v1");
    assert_eq!(output.content_key_hpke_wrapped.len(), 81);
}

#[test]
fn test_dispatch_xwing_path() {
    let mut seed = [0u8; 32];
    rand::fill(&mut seed);
    let xwing_pk = public_key_from_seed(&seed).expect("derive X-Wing public key");
    assert_eq!(xwing_pk.len(), 1216);

    let req = EncryptRequest {
        mailbox_id: "eeeeeeee-0000-0000-0000-000000000001".to_string(),
        message_seq: 1,
        mailbox_public_key: String::new(),
        plaintext: BASE64.encode(b"Subject: Test\r\n\r\nHello X-Wing"),
        storage_object_id: "mailboxes/eeeeeeee-0000-0000-0000-000000000001/00000000000000000001.eml.enc".to_string(),
        mailbox_sk_version: 1,
        mailbox_xwing_public_key: Some(BASE64.encode(&xwing_pk)),
    };

    let output = encrypt_payload(&req).expect("encrypt X-Wing payload");
    assert_eq!(output.wrapped_key_algorithm, "HPKE-XWing-AES256GCM-v1");
    assert_eq!(output.content_key_hpke_wrapped.len(), 1169);
}

#[test]
fn test_dispatch_invalid_xwing_key_length() {
    let invalid_pk = vec![0xaa; 1215];
    let req = EncryptRequest {
        mailbox_id: "eeeeeeee-0000-0000-0000-000000000001".to_string(),
        message_seq: 1,
        mailbox_public_key: String::new(),
        plaintext: BASE64.encode(b"Subject: Test\r\n\r\nHello"),
        storage_object_id: "mailboxes/eeeeeeee-0000-0000-0000-000000000001/00000000000000000001.eml.enc".to_string(),
        mailbox_sk_version: 1,
        mailbox_xwing_public_key: Some(BASE64.encode(&invalid_pk)),
    };

    let err = encrypt_payload(&req).expect_err("should reject invalid X-Wing key length");
    match err {
        EncryptError::BadRequest(msg) => {
            assert!(
                msg.contains("1216"),
                "expected error message to contain '1216', got: {msg}"
            );
        }
        EncryptError::Internal(msg) => {
            panic!("expected BadRequest, got Internal: {msg}");
        }
    }
}

#[test]
fn test_dispatch_round_trip_xwing() {
    let mut seed = [0u8; 32];
    rand::fill(&mut seed);
    let xwing_pk = public_key_from_seed(&seed).expect("derive X-Wing public key");

    let original_plaintext = b"Subject: Step 3 X-Wing\r\n\r\nPost-quantum storage pipeline verification";
    let message_seq = 42u64;

    let req = EncryptRequest {
        mailbox_id: "eeeeeeee-0000-0000-0000-000000000001".to_string(),
        message_seq,
        mailbox_public_key: String::new(),
        plaintext: BASE64.encode(original_plaintext),
        storage_object_id: "mailboxes/eeeeeeee-0000-0000-0000-000000000001/00000000000000000042.eml.enc".to_string(),
        mailbox_sk_version: 1,
        mailbox_xwing_public_key: Some(BASE64.encode(&xwing_pk)),
    };

    let output = encrypt_payload(&req).expect("encrypt payload");
    assert_eq!(output.wrapped_key_algorithm, "HPKE-XWing-AES256GCM-v1");
    assert_eq!(output.aad.len(), 29);

    let recovered = decrypt_message_xwing(
        &seed,
        &output.content_key_hpke_wrapped,
        &output.ciphertext,
        &output.aad,
    )
    .expect("decrypt X-Wing message");

    assert_eq!(recovered, original_plaintext);
}
