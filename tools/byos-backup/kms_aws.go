package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/kms"
	kmstypes "github.com/aws/aws-sdk-go-v2/service/kms/types"
)

const (
	remoteKeyEnvelopesKey = "keys/key_envelopes.json"
	maxKMSCASRetries      = 5
)

// AWSKMSClientAPI abstracts AWS KMS cryptographic operations for testability.
type AWSKMSClientAPI interface {
	GenerateDataKey(ctx context.Context, params *kms.GenerateDataKeyInput, optFns ...func(*kms.Options)) (*kms.GenerateDataKeyOutput, error)
	Decrypt(ctx context.Context, params *kms.DecryptInput, optFns ...func(*kms.Options)) (*kms.DecryptOutput, error)
}

// WrappedKeyEnvelope stores a KMS-encrypted 256-bit DEK without any plaintext key material.
type WrappedKeyEnvelope struct {
	VersionID         string    `json:"version_id"`
	KMSKeyID          string    `json:"kms_key_id"`
	CiphertextBlobB64 string    `json:"ciphertext_blob_b64"`
	CreatedAt         time.Time `json:"created_at"`
	Status            string    `json:"status"` // "active", "retired", "revoked"
}

// WrappedKeyManifest stores all versioned DEK envelopes for independent recovery-host lookup.
type WrappedKeyManifest struct {
	ManifestVersion int                           `json:"manifest_version"`
	ActiveVersion   string                        `json:"active_version"`
	UpdatedAt       time.Time                     `json:"updated_at"`
	Envelopes       map[string]WrappedKeyEnvelope `json:"envelopes"`
}

// AWSKMSKeyProvider implements KeyProvider using AWS KMS envelope encryption (GenerateDataKey / Decrypt).
type AWSKMSKeyProvider struct {
	mu           sync.RWMutex
	client       AWSKMSClientAPI
	kmsKeyID     string
	store        StorageDestination
	manifest     WrappedKeyManifest
	manifestETag string
	cache        map[string][]byte // in-memory unwrapped DEK cache (never persisted)
}

func kmsEncryptionContext(versionID string) map[string]string {
	return map[string]string{
		"byos_key_version": versionID,
		"byos_purpose":     "byos_backup",
	}
}

// NewAWSKMSKeyProvider constructs an AWSKMSKeyProvider using an existing KMS client and envelope store.
func NewAWSKMSKeyProvider(ctx context.Context, client AWSKMSClientAPI, kmsKeyID string, store StorageDestination) (*AWSKMSKeyProvider, error) {
	if client == nil {
		return nil, errors.New("aws-kms: client is required")
	}
	if store == nil {
		return nil, errors.New("aws-kms: envelope storage destination is required")
	}
	p := &AWSKMSKeyProvider{
		client:   client,
		kmsKeyID: strings.TrimSpace(kmsKeyID),
		store:    store,
		cache:    make(map[string][]byte),
	}
	if err := p.loadManifest(ctx); err != nil {
		return nil, err
	}
	return p, nil
}

// NewAWSKMSKeyProviderFromEnv initializes AWSKMSKeyProvider using the AWS SDK default credential chain (IAM role / STS).
func NewAWSKMSKeyProviderFromEnv(ctx context.Context, store StorageDestination) (*AWSKMSKeyProvider, error) {
	keyID := strings.TrimSpace(os.Getenv("BYOS_BACKUP_KMS_KEY_ID"))
	region := strings.TrimSpace(os.Getenv("BYOS_BACKUP_KMS_REGION"))
	if region == "" {
		region = strings.TrimSpace(os.Getenv("BYOS_BACKUP_REMOTE_REGION"))
	}
	var opts []func(*awsconfig.LoadOptions) error
	if region != "" {
		opts = append(opts, awsconfig.WithRegion(region))
	}
	cfg, err := awsconfig.LoadDefaultConfig(ctx, opts...)
	if err != nil {
		return nil, fmt.Errorf("loading AWS SDK config for KMS: %w", err)
	}
	client := kms.NewFromConfig(cfg)
	return NewAWSKMSKeyProvider(ctx, client, keyID, store)
}

func (p *AWSKMSKeyProvider) loadManifest(ctx context.Context) error {
	var data []byte
	var etag string
	var err error
	if c, ok := p.store.(ConditionalMutableStorageDestination); ok {
		data, _, etag, err = c.GetWithETag(ctx, remoteKeyEnvelopesKey)
	} else {
		data, _, err = p.store.Get(ctx, remoteKeyEnvelopesKey)
	}
	if err != nil {
		if errors.Is(err, ErrObjectNotFound) {
			p.manifest = WrappedKeyManifest{
				ManifestVersion: 1,
				Envelopes:       make(map[string]WrappedKeyEnvelope),
			}
			p.manifestETag = ""
			return nil
		}
		return fmt.Errorf("loading KMS key envelopes: %w", err)
	}
	var m WrappedKeyManifest
	if err := json.Unmarshal(data, &m); err != nil {
		return fmt.Errorf("parsing KMS key envelopes: %w", err)
	}
	if m.Envelopes == nil {
		m.Envelopes = make(map[string]WrappedKeyEnvelope)
	}
	p.manifest = m
	p.manifestETag = etag
	return nil
}

func (p *AWSKMSKeyProvider) saveManifestLocked(ctx context.Context) error {
	p.manifest.ManifestVersion = 1
	p.manifest.UpdatedAt = time.Now().UTC()
	raw, err := json.MarshalIndent(p.manifest, "", "  ")
	if err != nil {
		return err
	}
	if err := putMutableManifestCAS(ctx, p.store, remoteKeyEnvelopesKey, raw, map[string]string{
		"byos-key-manifest": "1",
	}, p.manifestETag); err != nil {
		return err
	}
	if info, infoErr := p.store.GetInfo(ctx, remoteKeyEnvelopesKey); infoErr == nil && info.ETag != "" {
		p.manifestETag = info.ETag
	} else if c, ok := p.store.(ConditionalMutableStorageDestination); ok {
		if _, _, newETag, getErr := c.GetWithETag(ctx, remoteKeyEnvelopesKey); getErr == nil {
			p.manifestETag = newETag
		}
	}
	return nil
}

func nextKeyVersionID(envelopes map[string]WrappedKeyEnvelope) string {
	maxVer := 0
	for k := range envelopes {
		if strings.HasPrefix(k, "v") {
			var n int
			if _, err := fmt.Sscanf(k, "v%d", &n); err == nil && n > maxVer {
				maxVer = n
			}
		}
	}
	return fmt.Sprintf("v%d", maxVer+1)
}

func (p *AWSKMSKeyProvider) Name() string {
	return "aws-kms"
}

func (p *AWSKMSKeyProvider) unwrapEnvelopeLocked(ctx context.Context, env WrappedKeyEnvelope) ([]byte, error) {
	if cached, ok := p.cache[env.VersionID]; ok && len(cached) == 32 {
		cp := make([]byte, 32)
		copy(cp, cached)
		return cp, nil
	}
	blob, err := base64.StdEncoding.DecodeString(env.CiphertextBlobB64)
	if err != nil {
		return nil, fmt.Errorf("decoding KMS ciphertext blob for %s: %w", env.VersionID, err)
	}
	out, err := p.client.Decrypt(ctx, &kms.DecryptInput{
		CiphertextBlob:    blob,
		EncryptionContext: kmsEncryptionContext(env.VersionID),
	})
	if err != nil {
		return nil, fmt.Errorf("AWS KMS Decrypt failed for %s: %w", env.VersionID, err)
	}
	if len(out.Plaintext) != 32 {
		return nil, fmt.Errorf("AWS KMS returned invalid DEK length %d (expected 32)", len(out.Plaintext))
	}
	cp := make([]byte, 32)
	copy(cp, out.Plaintext)
	p.cache[env.VersionID] = cp
	ret := make([]byte, 32)
	copy(ret, cp)
	return ret, nil
}

func (p *AWSKMSKeyProvider) GetActiveKey(ctx context.Context) (KeyVersion, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.manifest.ActiveVersion == "" {
		return KeyVersion{}, ErrNoActiveKey
	}
	env, ok := p.manifest.Envelopes[p.manifest.ActiveVersion]
	if !ok || env.Status != "active" {
		return KeyVersion{}, ErrNoActiveKey
	}
	dek, err := p.unwrapEnvelopeLocked(ctx, env)
	if err != nil {
		return KeyVersion{}, err
	}
	return KeyVersion{
		VersionID: env.VersionID,
		Key:       dek,
		CreatedAt: env.CreatedAt,
		Status:    env.Status,
	}, nil
}

func (p *AWSKMSKeyProvider) GetKeyVersion(ctx context.Context, versionID string) (KeyVersion, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	env, ok := p.manifest.Envelopes[versionID]
	if !ok {
		return KeyVersion{}, fmt.Errorf("%w: %s", ErrKeyNotFound, versionID)
	}
	if env.Status == "revoked" {
		return KeyVersion{}, fmt.Errorf("%w: %s", ErrKeyRevoked, versionID)
	}
	dek, err := p.unwrapEnvelopeLocked(ctx, env)
	if err != nil {
		return KeyVersion{}, err
	}
	return KeyVersion{
		VersionID: env.VersionID,
		Key:       dek,
		CreatedAt: env.CreatedAt,
		Status:    env.Status,
	}, nil
}

func (p *AWSKMSKeyProvider) ListKeyVersions(ctx context.Context) ([]KeyVersion, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	out := make([]KeyVersion, 0, len(p.manifest.Envelopes))
	for _, env := range p.manifest.Envelopes {
		out = append(out, KeyVersion{
			VersionID: env.VersionID,
			CreatedAt: env.CreatedAt,
			Status:    env.Status,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].VersionID < out[j].VersionID })
	return out, nil
}

func (p *AWSKMSKeyProvider) RotateKey(ctx context.Context) (KeyVersion, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.kmsKeyID == "" {
		return KeyVersion{}, errors.New("aws-kms: BYOS_BACKUP_KMS_KEY_ID is required to generate/rotate data keys")
	}

	for attempt := 0; attempt < maxKMSCASRetries; attempt++ {
		if attempt > 0 {
			if err := p.loadManifest(ctx); err != nil {
				return KeyVersion{}, err
			}
		}
		newVer := nextKeyVersionID(p.manifest.Envelopes)
		genOut, err := p.client.GenerateDataKey(ctx, &kms.GenerateDataKeyInput{
			KeyId:             aws.String(p.kmsKeyID),
			KeySpec:           kmstypes.DataKeySpecAes256,
			EncryptionContext: kmsEncryptionContext(newVer),
		})
		if err != nil {
			return KeyVersion{}, fmt.Errorf("AWS KMS GenerateDataKey failed: %w", err)
		}
		if len(genOut.Plaintext) != 32 {
			return KeyVersion{}, fmt.Errorf("AWS KMS GenerateDataKey returned %d bytes (expected 32)", len(genOut.Plaintext))
		}

		if old, ok := p.manifest.Envelopes[p.manifest.ActiveVersion]; ok {
			old.Status = "retired"
			p.manifest.Envelopes[p.manifest.ActiveVersion] = old
		}

		now := time.Now().UTC()
		p.manifest.Envelopes[newVer] = WrappedKeyEnvelope{
			VersionID:         newVer,
			KMSKeyID:          p.kmsKeyID,
			CiphertextBlobB64: base64.StdEncoding.EncodeToString(genOut.CiphertextBlob),
			CreatedAt:         now,
			Status:            "active",
		}
		p.manifest.ActiveVersion = newVer

		if err := p.saveManifestLocked(ctx); err != nil {
			if errors.Is(err, ErrPreconditionFailed) {
				continue
			}
			// ErrObjectNotFound during PutIfMatch means the manifest was deleted by a concurrent
			// writer (e.g. a delete marker was inserted). Fail closed to avoid creating a new
			// manifest that discards all historical key envelopes.
			if errors.Is(err, ErrObjectNotFound) {
				return KeyVersion{}, fmt.Errorf("persisting wrapped KMS envelope: manifest disappeared during CAS (possible concurrent delete marker): %w", err)
			}
			return KeyVersion{}, fmt.Errorf("persisting wrapped KMS envelope: %w", err)
		}

		cp := make([]byte, 32)
		copy(cp, genOut.Plaintext)
		p.cache[newVer] = cp

		ret := make([]byte, 32)
		copy(ret, cp)
		return KeyVersion{
			VersionID: newVer,
			Key:       ret,
			CreatedAt: now,
			Status:    "active",
		}, nil
	}
	return KeyVersion{}, fmt.Errorf("persisting wrapped KMS envelope: %w (exceeded %d CAS retries)", ErrPreconditionFailed, maxKMSCASRetries)
}

func (p *AWSKMSKeyProvider) RetireKey(ctx context.Context, versionID string) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	env, ok := p.manifest.Envelopes[versionID]
	if !ok {
		return ErrKeyNotFound
	}
	if p.manifest.ActiveVersion == versionID {
		return errors.New("cannot retire currently active key without rotating first")
	}
	env.Status = "retired"
	p.manifest.Envelopes[versionID] = env
	return p.saveManifestLocked(ctx)
}

func (p *AWSKMSKeyProvider) RevokeKey(ctx context.Context, versionID string) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	env, ok := p.manifest.Envelopes[versionID]
	if !ok {
		return ErrKeyNotFound
	}
	if p.manifest.ActiveVersion == versionID {
		return errors.New("cannot revoke currently active key")
	}
	env.Status = "revoked"
	p.manifest.Envelopes[versionID] = env
	delete(p.cache, versionID)
	return p.saveManifestLocked(ctx)
}
