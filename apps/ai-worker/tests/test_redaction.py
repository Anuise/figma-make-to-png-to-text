from pathlib import Path

from ai_worker.redaction import is_sensitive_path, scrub_secrets


def test_denylists_common_secret_filenames():
    assert is_sensitive_path(Path(".env"))
    assert is_sensitive_path(Path(".env.local"))
    assert is_sensitive_path(Path("config/id_rsa"))
    assert is_sensitive_path(Path("keys/server.pem"))
    assert is_sensitive_path(Path("keys/server.key"))
    assert is_sensitive_path(Path(".npmrc"))
    assert is_sensitive_path(Path("credentials.json"))


def test_denylists_entire_directories_regardless_of_filename():
    assert is_sensitive_path(Path("node_modules/some-pkg/index.js"))
    assert is_sensitive_path(Path(".git/config"))


def test_allows_ordinary_source_files():
    assert not is_sensitive_path(Path("src/pages/checkout.tsx"))
    assert not is_sensitive_path(Path("README.md"))


def test_scrubs_aws_access_key_id():
    text = "AWS_KEY=AKIAABCDEFGHIJKLMNOP end"
    assert "AKIAABCDEFGHIJKLMNOP" not in scrub_secrets(text)


def test_scrubs_bearer_tokens():
    text = "Authorization: Bearer abc123.def456-ghi"
    scrubbed = scrub_secrets(text)
    assert "abc123.def456-ghi" not in scrubbed
    assert "[REDACTED]" in scrubbed


def test_scrubs_pem_private_keys():
    text = "-----BEGIN RSA PRIVATE KEY-----\nMIIEow==\n-----END RSA PRIVATE KEY-----"
    scrubbed = scrub_secrets(text)
    assert "MIIEow==" not in scrubbed


def test_scrubs_generic_key_value_secrets():
    text = 'const apiKey = "sk_live_abcdefgh12345678";'
    scrubbed = scrub_secrets(text)
    assert "sk_live_abcdefgh12345678" not in scrubbed


def test_leaves_unrelated_text_untouched():
    text = "This screen shows the checkout confirmation."
    assert scrub_secrets(text) == text
