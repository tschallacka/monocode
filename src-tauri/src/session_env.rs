//! A session's environment variables are often credentials, so the store keeps
//! them sealed with AES-256-GCM. The key lives in the system credential store,
//! never beside the database, and is read only once a session has variables.

use std::sync::Mutex;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM, NONCE_LEN};
use ring::rand::{SecureRandom, SystemRandom};
use serde_json::Value;

#[cfg(not(test))]
const KEYRING_SERVICE: &str = "MonoCode";
#[cfg(not(test))]
const KEYRING_ACCOUNT: &str = "session-env-key";
const PREFIX: &str = "aes256gcm:";

static KEY: Mutex<Option<[u8; 32]>> = Mutex::new(None);

/// A POSIX shell would accept it before a command, as in `NAME=value cmd`.
pub(crate) fn is_env_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars
        .next()
        .is_some_and(|first| first == '_' || first.is_ascii_alphabetic())
        && chars.all(|c| c == '_' || c.is_ascii_alphanumeric())
}

/// An object of valid names to string values.
pub(crate) fn validate(env: &Value) -> Result<(), String> {
    let vars = env.as_object().ok_or("env must be an object")?;
    for (name, value) in vars {
        if !is_env_name(name) {
            return Err(format!("Not a valid environment variable name: {name}"));
        }
        if !value.is_string() {
            return Err(format!("{name} must be a string"));
        }
    }
    Ok(())
}

/// The column value for `env`: a tagged, base64 nonce and ciphertext.
pub(crate) fn seal(env: &Value) -> Result<String, String> {
    let plain = serde_json::to_vec(env).map_err(|e| e.to_string())?;
    seal_with(&key()?, &plain)
}

/// Fails rather than guessing when the key is gone or the column was altered.
pub(crate) fn open(column: &str) -> Result<Value, String> {
    let plain = open_with(&key()?, column)?;
    serde_json::from_slice(&plain).map_err(|e| e.to_string())
}

fn seal_with(key: &[u8; 32], plain: &[u8]) -> Result<String, String> {
    let mut nonce = [0u8; NONCE_LEN];
    SystemRandom::new()
        .fill(&mut nonce)
        .map_err(|_| "Could not generate a nonce".to_string())?;
    let mut sealed = plain.to_vec();
    cipher(key)?
        .seal_in_place_append_tag(
            Nonce::assume_unique_for_key(nonce),
            Aad::empty(),
            &mut sealed,
        )
        .map_err(|_| "Could not encrypt the session environment".to_string())?;
    let mut out = nonce.to_vec();
    out.extend_from_slice(&sealed);
    Ok(format!("{PREFIX}{}", STANDARD.encode(out)))
}

fn open_with(key: &[u8; 32], column: &str) -> Result<Vec<u8>, String> {
    let encoded = column
        .strip_prefix(PREFIX)
        .ok_or_else(|| "The session environment is not encrypted".to_string())?;
    let mut bytes = STANDARD.decode(encoded).map_err(|e| e.to_string())?;
    if bytes.len() < NONCE_LEN {
        return Err("The session environment is truncated".into());
    }
    let mut sealed = bytes.split_off(NONCE_LEN);
    let nonce = Nonce::try_assume_unique_for_key(&bytes)
        .map_err(|_| "The session environment is truncated".to_string())?;
    let plain = cipher(key)?
        .open_in_place(nonce, Aad::empty(), &mut sealed)
        .map_err(|_| "Could not decrypt the session environment".to_string())?;
    Ok(plain.to_vec())
}

fn cipher(key: &[u8; 32]) -> Result<LessSafeKey, String> {
    UnboundKey::new(&AES_256_GCM, key)
        .map(LessSafeKey::new)
        .map_err(|_| "Invalid session environment key".to_string())
}

fn key() -> Result<[u8; 32], String> {
    let mut cached = KEY.lock().map_err(|_| "Session key is locked")?;
    if let Some(key) = *cached {
        return Ok(key);
    }
    let key = load_or_create_key()?;
    *cached = Some(key);
    Ok(key)
}

#[cfg(not(test))]
fn load_or_create_key() -> Result<[u8; 32], String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|_| "Could not access the system credential store".to_string())?;
    match entry.get_password() {
        Ok(stored) => decode_key(&stored),
        // Only a missing entry may mint a key: replacing an unreadable one
        // would make every sealed environment undecryptable.
        Err(keyring::Error::NoEntry) => {
            let mut key = [0u8; 32];
            SystemRandom::new()
                .fill(&mut key)
                .map_err(|_| "Could not generate a session key".to_string())?;
            entry
                .set_password(&STANDARD.encode(key))
                .map_err(|_| "Could not save the session key".to_string())?;
            Ok(key)
        }
        Err(_) => Err("Could not read the session key from the system credential store".into()),
    }
}

/// Tests never touch the real credential store.
#[cfg(test)]
fn load_or_create_key() -> Result<[u8; 32], String> {
    Ok([7u8; 32])
}

#[cfg(not(test))]
fn decode_key(stored: &str) -> Result<[u8; 32], String> {
    STANDARD
        .decode(stored.trim())
        .ok()
        .and_then(|bytes| <[u8; 32]>::try_from(bytes).ok())
        .ok_or_else(|| "The stored session key is malformed".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sealed_environment_round_trips_without_plain_text() {
        let env = json!({ "API_TOKEN": "s3cret value", "REGION": "eu" });
        let column = seal(&env).unwrap();
        assert!(column.starts_with(PREFIX));
        assert!(!column.contains("s3cret"));
        assert!(!column.contains("API_TOKEN"));
        assert_eq!(open(&column).unwrap(), env);
    }

    #[test]
    fn each_seal_uses_a_fresh_nonce() {
        let env = json!({ "A": "1" });
        assert_ne!(seal(&env).unwrap(), seal(&env).unwrap());
    }

    #[test]
    fn tampered_or_plain_columns_are_refused() {
        let column = seal(&json!({ "A": "1" })).unwrap();
        let mut bytes = STANDARD.decode(&column[PREFIX.len()..]).unwrap();
        let last = bytes.len() - 1;
        bytes[last] ^= 1;
        assert!(open(&format!("{PREFIX}{}", STANDARD.encode(bytes))).is_err());
        assert!(open(r#"{"A":"1"}"#).is_err());
        assert!(open_with(&[8u8; 32], &column).is_err());
    }
}
