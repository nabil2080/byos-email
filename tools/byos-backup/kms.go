package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"
)

var (
	ErrKeyNotFound      = errors.New("kms: key version not found")
	ErrKeyRevoked       = errors.New("kms: key version is revoked")
	ErrNoActiveKey      = errors.New("kms: no active key configured")
	ErrKeyInUseByBackup = errors.New("kms: cannot retire key version still required by active backups")
)

// KeyVersion represents a versioned cryptographic key.
type KeyVersion struct {
	VersionID string    `json:"version_id"`
	Key       []byte    `json:"-"` // Never serialized in logs or manifests
	CreatedAt time.Time `json:"created_at"`
	Status    string    `json:"status"` // "active", "retired", "revoked"
}

// KeyProvider is the abstraction for key management systems (local, env, AWS KMS, HashiCorp Vault).
type KeyProvider interface {
	Name() string
	GetActiveKey(ctx context.Context) (KeyVersion, error)
	GetKeyVersion(ctx context.Context, versionID string) (KeyVersion, error)
	ListKeyVersions(ctx context.Context) ([]KeyVersion, error)
	RotateKey(ctx context.Context) (KeyVersion, error)
	RetireKey(ctx context.Context, versionID string) error
	RevokeKey(ctx context.Context, versionID string) error
}

// EnvKeyProvider provides keys via environment variables (e.g. BYOS_BACKUP_ENCRYPTION_KEY).
type EnvKeyProvider struct {
	mu           sync.RWMutex
	activeVer    string
	keysByVer    map[string]KeyVersion
	activeKeyRaw []byte
}

// NewEnvKeyProvider initializes a provider from environment variables and optional fallback file.
func NewEnvKeyProvider(activeKeyHex string, defaultVer string) (*EnvKeyProvider, error) {
	if envVer := os.Getenv("BYOS_BACKUP_KEY_VERSION"); envVer != "" {
		defaultVer = strings.ToLower(envVer)
	} else if envVer := os.Getenv("BYOS_BACKUP_ACTIVE_KEY_VERSION"); envVer != "" {
		defaultVer = strings.ToLower(envVer)
	}
	if defaultVer == "" {
		defaultVer = "v1"
	}
	p := &EnvKeyProvider{
		activeVer: defaultVer,
		keysByVer: make(map[string]KeyVersion),
	}

	if activeKeyHex == "" {
		activeKeyHex = os.Getenv("BYOS_BACKUP_ENCRYPTION_KEY")
	}

	if activeKeyHex != "" {
		raw, err := ParseEncryptionKey(activeKeyHex)
		if err != nil {
			return nil, fmt.Errorf("parsing active key: %w", err)
		}
		p.activeKeyRaw = raw
		p.keysByVer[defaultVer] = KeyVersion{
			VersionID: defaultVer,
			Key:       raw,
			CreatedAt: time.Now().UTC(),
			Status:    "active",
		}
	}

	// Scan environment for historical keys: BYOS_BACKUP_KEY_<VERSION>
	for _, env := range os.Environ() {
		parts := strings.SplitN(env, "=", 2)
		if len(parts) == 2 && strings.HasPrefix(parts[0], "BYOS_BACKUP_KEY_") {
			ver := strings.ToLower(strings.TrimPrefix(parts[0], "BYOS_BACKUP_KEY_"))
			raw, err := ParseEncryptionKey(parts[1])
			if err == nil {
				status := "retired"
				if ver == p.activeVer {
					status = "active"
				}
				p.keysByVer[ver] = KeyVersion{
					VersionID: ver,
					Key:       raw,
					CreatedAt: time.Now().UTC(),
					Status:    status,
				}
			}
		}
	}

	return p, nil
}

func (p *EnvKeyProvider) Name() string {
	return "env"
}

func (p *EnvKeyProvider) GetActiveKey(ctx context.Context) (KeyVersion, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	kv, ok := p.keysByVer[p.activeVer]
	if !ok || kv.Status != "active" {
		return KeyVersion{}, ErrNoActiveKey
	}
	return kv, nil
}

func (p *EnvKeyProvider) GetKeyVersion(ctx context.Context, versionID string) (KeyVersion, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	kv, ok := p.keysByVer[versionID]
	if !ok {
		return KeyVersion{}, fmt.Errorf("%w: %s", ErrKeyNotFound, versionID)
	}
	if kv.Status == "revoked" {
		return KeyVersion{}, fmt.Errorf("%w: %s", ErrKeyRevoked, versionID)
	}
	return kv, nil
}

func (p *EnvKeyProvider) ListKeyVersions(ctx context.Context) ([]KeyVersion, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	list := make([]KeyVersion, 0, len(p.keysByVer))
	for _, kv := range p.keysByVer {
		list = append(list, kv)
	}
	return list, nil
}

func (p *EnvKeyProvider) RotateKey(ctx context.Context) (KeyVersion, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	// Generate a new 32-byte cryptographically secure random key
	newKey := make([]byte, 32)
	if _, err := rand.Read(newKey); err != nil {
		return KeyVersion{}, fmt.Errorf("generating random key: %w", err)
	}

	// Mark old active key as retired
	if old, ok := p.keysByVer[p.activeVer]; ok {
		old.Status = "retired"
		p.keysByVer[p.activeVer] = old
	}

	newVer := fmt.Sprintf("v%d", len(p.keysByVer)+1)
	newKV := KeyVersion{
		VersionID: newVer,
		Key:       newKey,
		CreatedAt: time.Now().UTC(),
		Status:    "active",
	}

	p.keysByVer[newVer] = newKV
	p.activeVer = newVer
	p.activeKeyRaw = newKey

	return newKV, nil
}

func (p *EnvKeyProvider) RetireKey(ctx context.Context, versionID string) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	kv, ok := p.keysByVer[versionID]
	if !ok {
		return ErrKeyNotFound
	}
	if p.activeVer == versionID {
		return errors.New("cannot retire currently active key without rotating first")
	}
	kv.Status = "retired"
	p.keysByVer[versionID] = kv
	return nil
}

func (p *EnvKeyProvider) RevokeKey(ctx context.Context, versionID string) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	kv, ok := p.keysByVer[versionID]
	if !ok {
		return ErrKeyNotFound
	}
	if p.activeVer == versionID {
		return errors.New("cannot revoke currently active key")
	}
	kv.Status = "revoked"
	p.keysByVer[versionID] = kv
	return nil
}

// GenerateRandomKeyHex returns a 64-char hex encoded 256-bit key.
func GenerateRandomKeyHex() (string, error) {
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return "", err
	}
	return hex.EncodeToString(key), nil
}
