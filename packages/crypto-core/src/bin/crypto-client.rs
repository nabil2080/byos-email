use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use byos_crypto_core::{aes_gcm_decrypt, canonical_aad, decrypt_outbound, encrypt_outbound, DkimKeypair, generate_x25519_keypair, hpke_open};
use std::{env, process::ExitCode};
use uuid::Uuid;

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), String> {
    let args: Vec<String> = env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("generate") => generate(),
        Some("generate-dkim") => generate_dkim(&args[1..]),
        Some("decrypt") => decrypt(&args[1..]),
        Some("encrypt-outbound") => encrypt_outbound_cli(&args[1..]),
        Some("decrypt-outbound") => decrypt_outbound_cli(&args[1..]),
        _ => Err("usage: byos-crypto-client generate | generate-dkim <selector> | decrypt <mailbox-id> <message-seq> <secret-key-b64> <wrapped-key-b64> <ciphertext-b64> | encrypt-outbound <outbound-pk-b64> <mailbox-id> <outbox-seq> <plaintext-b64> | decrypt-outbound <outbound-sk-b64> <mailbox-id> <outbox-seq> <wrapped-b64> <ciphertext-b64>".to_owned()),
    }
}

fn generate() -> Result<(), String> {
    let (secret_key, public_key) = generate_x25519_keypair();
    println!(
        "{}",
        serde_json::json!({
            "secret_key": BASE64.encode(secret_key),
            "public_key": BASE64.encode(public_key),
        })
    );
    Ok(())
}

fn generate_dkim(args: &[String]) -> Result<(), String> {
    if args.len() < 1 {
        return Err("generate-dkim requires <selector>".to_owned());
    }
    let selector = &args[0];
    let keypair = DkimKeypair::generate(selector).map_err(|e| e.to_string())?;
    println!(
        "{}",
        serde_json::json!({
            "selector": keypair.selector,
            "private_key_pem": keypair.private_key_pem,
            "public_key_pem": keypair.public_key_pem,
            "dns_txt": keypair.dns_txt_value(),
        })
    );
    Ok(())
}

fn decrypt(args: &[String]) -> Result<(), String> {
    if args.len() != 5 {
        return Err("decrypt requires mailbox-id, message-seq, secret-key-b64, wrapped-key-b64, and ciphertext-b64".to_owned());
    }

    let mailbox_id = Uuid::parse_str(&args[0])
        .map_err(|_| "mailbox-id must be a UUID".to_owned())?
        .into_bytes();
    let message_seq = args[1]
        .parse::<u64>()
        .map_err(|_| "message-seq must be an unsigned integer".to_owned())?;
    let secret_key: [u8; 32] = decode(&args[2], "secret-key")?
        .try_into()
        .map_err(|_| "secret-key must decode to 32 bytes".to_owned())?;
    let wrapped_key = decode(&args[3], "wrapped-key")?;
    let ciphertext = decode(&args[4], "ciphertext")?;
    let aad = canonical_aad(&mailbox_id, message_seq, 1);
    let content_key: [u8; 32] = hpke_open(&secret_key, &wrapped_key, &aad)
        .map_err(|error| error.to_string())?
        .try_into()
        .map_err(|_| "wrapped content key did not decrypt to 32 bytes".to_owned())?;
    let plaintext =
        aes_gcm_decrypt(&content_key, &ciphertext, &aad).map_err(|error| error.to_string())?;

    println!("{}", BASE64.encode(plaintext));
    Ok(())
}

fn encrypt_outbound_cli(args: &[String]) -> Result<(), String> {
    if args.len() != 4 {
        return Err("encrypt-outbound requires outbound-pk-b64, mailbox-id, outbox-seq, plaintext-b64".to_owned());
    }
    let pk: [u8; 32] = decode(&args[0], "outbound-pk")?
        .try_into()
        .map_err(|_| "outbound-pk must decode to 32 bytes".to_owned())?;
    let mailbox_id = Uuid::parse_str(&args[1])
        .map_err(|_| "mailbox-id must be a UUID".to_owned())?
        .into_bytes();
    let outbox_seq = args[2]
        .parse::<u64>()
        .map_err(|_| "outbox-seq must be unsigned integer".to_owned())?;
    let plaintext = decode(&args[3], "plaintext")?;
    let (ciphertext, wrapped, iv, aad, _) =
        encrypt_outbound(&pk, &mailbox_id, outbox_seq, &plaintext).map_err(|e| e.to_string())?;
    println!(
        "{}",
        serde_json::json!({
            "ciphertext": BASE64.encode(ciphertext),
            "wrapped": BASE64.encode(wrapped),
            "iv": BASE64.encode(iv),
            "aad": BASE64.encode(aad),
        })
    );
    Ok(())
}

fn decrypt_outbound_cli(args: &[String]) -> Result<(), String> {
    if args.len() != 5 {
        return Err("decrypt-outbound requires outbound-sk-b64, mailbox-id, outbox-seq, wrapped-b64, ciphertext-b64".to_owned());
    }
    let sk: [u8; 32] = decode(&args[0], "outbound-sk")?
        .try_into()
        .map_err(|_| "outbound-sk must decode to 32 bytes".to_owned())?;
    let mailbox_id = Uuid::parse_str(&args[1])
        .map_err(|_| "mailbox-id must be a UUID".to_owned())?
        .into_bytes();
    let outbox_seq = args[2]
        .parse::<u64>()
        .map_err(|_| "outbox-seq must be unsigned integer".to_owned())?;
    let wrapped = decode(&args[3], "wrapped")?;
    let ciphertext = decode(&args[4], "ciphertext")?;
    let plaintext = decrypt_outbound(&sk, &wrapped, &mailbox_id, outbox_seq, &ciphertext).map_err(|e| e.to_string())?;
    println!("{}", BASE64.encode(plaintext));
    Ok(())
}

fn decode(value: &str, field: &str) -> Result<Vec<u8>, String> {
    BASE64
        .decode(value)
        .map_err(|_| format!("{field} must be base64"))
}
