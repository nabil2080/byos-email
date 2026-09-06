package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestStorageHealthInterval(t *testing.T) {
	t.Setenv("STORAGE_HEALTH_INTERVAL", "")
	if got := storageHealthInterval(); got != 5*time.Minute {
		t.Fatalf("default interval = %s, want 5m", got)
	}
	t.Setenv("STORAGE_HEALTH_INTERVAL", "17")
	if got := storageHealthInterval(); got != 17*time.Second {
		t.Fatalf("configured interval = %s, want 17s", got)
	}
	t.Setenv("STORAGE_HEALTH_INTERVAL", "0")
	if got := storageHealthInterval(); got != 0 {
		t.Fatalf("disabled interval = %s, want 0", got)
	}
}

func TestTestEncryptedStorage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("method = %s, want POST", r.Method)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok","code":"verified"}`))
	}))
	defer server.Close()
	t.Setenv("STORAGE_WORKER_URL", server.URL)
	if got := testEncryptedStorage("minio", "opaque-ciphertext"); got != "verified" {
		t.Fatalf("health result = %q, want verified", got)
	}
}

func TestTestEncryptedStorageRejectsMissingInput(t *testing.T) {
	if got := testEncryptedStorage("", "opaque-ciphertext"); got != "configuration_error" {
		t.Fatalf("missing provider result = %q, want configuration_error", got)
	}
	if got := testEncryptedStorage("minio", ""); got != "configuration_error" {
		t.Fatalf("missing ciphertext result = %q, want configuration_error", got)
	}
}
