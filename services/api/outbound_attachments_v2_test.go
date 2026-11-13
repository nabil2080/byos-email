package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

func buildV2CiphertextSample(plaintext []byte) []byte {
	// Deterministic structural 0x01 || nonce(12) || plaintext || tag(16) sample for API wire tests.
	out := make([]byte, 1+12+len(plaintext)+16)
	out[0] = 0x01
	for i := 1; i < 13; i++ {
		out[i] = byte(i)
	}
	copy(out[13:], plaintext)
	for i := 13 + len(plaintext); i < len(out); i++ {
		out[i] = 0xAA
	}
	return out
}

func makeV2MultipartRequest(
	t *testing.T,
	mailboxID string,
	attID string,
	filename string,
	contentType string,
	plaintext []byte,
	ciphertext []byte,
	ctShaHex string,
	ownerKeyVer int,
	ownerPkShaHex string,
) (*bytes.Buffer, string) {
	t.Helper()
	ptSum := sha256.Sum256(plaintext)
	if ctShaHex == "" {
		ctSum := sha256.Sum256(ciphertext)
		ctShaHex = hex.EncodeToString(ctSum[:])
	}
	cekWrapped := bytes.Repeat([]byte{0x42}, 81)
	cekWrapped[0] = 0x01
	if ownerPkShaHex == "" {
		pkSum := sha256.Sum256(bytes.Repeat([]byte{0x11}, 32))
		ownerPkShaHex = hex.EncodeToString(pkSum[:])
	}

	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	part, err := w.CreateFormFile("file", filename)
	if err != nil {
		t.Fatalf("CreateFormFile: %v", err)
	}
	if _, err := part.Write(ciphertext); err != nil {
		t.Fatalf("part.Write: %v", err)
	}
	_ = w.WriteField("crypto_version", "2")
	_ = w.WriteField("attachment_id", attID)
	_ = w.WriteField("filename", filename)
	_ = w.WriteField("content_type", contentType)
	_ = w.WriteField("plaintext_size_bytes", strconv.Itoa(len(plaintext)))
	_ = w.WriteField("blob_aad_version", "2")
	_ = w.WriteField("owner_wrap_alg", AttachmentWrapAlgX25519)
	_ = w.WriteField("owner_key_version", strconv.Itoa(ownerKeyVer))
	_ = w.WriteField("owner_pk_sha256", ownerPkShaHex)
	_ = w.WriteField("cek_owner_wrapped", base64.StdEncoding.EncodeToString(cekWrapped))
	_ = w.WriteField("plaintext_sha256", hex.EncodeToString(ptSum[:]))
	_ = w.WriteField("ciphertext_sha256", ctShaHex)
	_ = w.Close()
	return &body, w.FormDataContentType()
}

func TestAttachmentV2UploadDownloadAndRejectionCases(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	oldRedis := redisClient
	if os.Getenv("REDIS_ADDR") == "" {
		t.Setenv("REDIS_ADDR", "127.0.0.1:6379")
	}
	initRedis()
	defer func() { redisClient = oldRedis }()
	loadRateLimits()

	// Ensure v2 schema is applied on this isolated test DB
	var hasV2 bool
	if err := db.QueryRow(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='attachments' AND column_name='crypto_version')`).Scan(&hasV2); err != nil || !hasV2 {
		t.Skip("skipping v2 attachment tests: proposed_070 schema not applied on test DB")
	}

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, orgID, ownerID, "attv2")
	token := createTestSession(t, db, ownerID)

	// Configure deterministic mailbox_pk and mailbox_sk_version=2
	ownerPk := bytes.Repeat([]byte{0x22}, 32)
	ownerPkSum := sha256.Sum256(ownerPk)
	ownerPkShaHex := hex.EncodeToString(ownerPkSum[:])
	if _, err := db.Exec(`UPDATE mailboxes SET mailbox_pk = $1, mailbox_sk_version = 2 WHERE id = $2`, ownerPk, mailboxID); err != nil {
		t.Fatalf("update mailbox_pk: %v", err)
	}

	var mu sync.Mutex
	storedObjects := make(map[string][]byte)
	deletedKeys := make([]string, 0)

	mockStorage := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		switch r.URL.Path {
		case "/api/store":
			objKey := r.Header.Get("X-Object-Key")
			data, _ := io.ReadAll(r.Body)
			storedObjects[objKey] = data
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"status":"stored"}`))
		case "/api/retrieve":
			var req struct {
				ObjectKey string `json:"object_key"`
			}
			_ = json.NewDecoder(r.Body).Decode(&req)
			data, ok := storedObjects[req.ObjectKey]
			if !ok {
				http.Error(w, "not found", http.StatusNotFound)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"data": data,
				"size": len(data),
			})
		case "/api/delete":
			var req struct {
				ObjectKey string `json:"object_key"`
			}
			_ = json.NewDecoder(r.Body).Decode(&req)
			delete(storedObjects, req.ObjectKey)
			deletedKeys = append(deletedKeys, req.ObjectKey)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"status":"deleted"}`))
		default:
			http.Error(w, "not found", http.StatusNotFound)
		}
	}))
	defer mockStorage.Close()
	t.Setenv("STORAGE_WORKER_URL", mockStorage.URL)
	t.Setenv("STORAGE_WORKER_INTERNAL_KEY", "test-storage-key")

	// 1. Upload 0-byte attachment with Unicode filename (crypto_version=2) -> 201
	zeroAttID := uuid.NewString()
	zeroPT := []byte{}
	zeroCT := buildV2CiphertextSample(zeroPT)
	b1, ct1 := makeV2MultipartRequest(t, mailboxID, zeroAttID, "résumé_日本語.pdf", "application/pdf", zeroPT, zeroCT, "", 2, ownerPkShaHex)
	req := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/attachments", b1)
	req.SetPathValue("mailbox_id", mailboxID)
	req.Header.Set("Content-Type", ct1)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	rec := httptest.NewRecorder()
	attachmentsHandler(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("0-byte v2 upload status = %d, want 201, body=%s", rec.Code, rec.Body.String())
	}
	var attResp AttachmentResponse
	if err := json.NewDecoder(rec.Body).Decode(&attResp); err != nil {
		t.Fatalf("decode upload resp: %v", err)
	}
	if attResp.ID != zeroAttID || attResp.CryptoVersion != 2 || attResp.SizeBytes != 0 || attResp.CiphertextSizeBytes != 29 {
		t.Fatalf("unexpected v2 attachment response: %+v", attResp)
	}

	// 2. Download ?download=true for 0-byte v2 attachment succeeds (does not trip SEC-005 plaintext=0 check)
	req = httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+mailboxID+"/attachments/"+zeroAttID+"?download=true", nil)
	req.SetPathValue("mailbox_id", mailboxID)
	req.SetPathValue("attachment_id", zeroAttID)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	rec = httptest.NewRecorder()
	attachmentsHandler(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("0-byte v2 download status = %d, want 200, body=%s", rec.Code, rec.Body.String())
	}
	if !bytes.Equal(rec.Body.Bytes(), zeroCT) {
		t.Fatalf("downloaded ciphertext mismatch: got %d bytes, want %d", rec.Body.Len(), len(zeroCT))
	}

	// 3. Duplicate attachment_id -> 409 Conflict
	bDup, ctDup := makeV2MultipartRequest(t, mailboxID, zeroAttID, "dup.pdf", "application/pdf", zeroPT, zeroCT, "", 2, ownerPkShaHex)
	req = httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/attachments", bDup)
	req.SetPathValue("mailbox_id", mailboxID)
	req.Header.Set("Content-Type", ctDup)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	rec = httptest.NewRecorder()
	attachmentsHandler(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("duplicate attachment_id status = %d, want 409", rec.Code)
	}

	// 4. Stale owner_key_version -> 409 Conflict
	staleID := uuid.NewString()
	bStale, ctStale := makeV2MultipartRequest(t, mailboxID, staleID, "stale.pdf", "application/pdf", []byte("abc"), buildV2CiphertextSample([]byte("abc")), "", 1, ownerPkShaHex)
	req = httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/attachments", bStale)
	req.SetPathValue("mailbox_id", mailboxID)
	req.Header.Set("Content-Type", ctStale)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	rec = httptest.NewRecorder()
	attachmentsHandler(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("stale owner_key_version status = %d, want 409, body=%s", rec.Code, rec.Body.String())
	}

	// 5. Ciphertext SHA-256 mismatch -> 400 Bad Request + compensating delete called + no DB row
	badHashID := uuid.NewString()
	badCT := buildV2CiphertextSample([]byte("corrupt"))
	bBad, ctBad := makeV2MultipartRequest(t, mailboxID, badHashID, "bad.pdf", "application/pdf", []byte("corrupt"), badCT, strings.Repeat("ff", 32), 2, ownerPkShaHex)
	req = httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/attachments", bBad)
	req.SetPathValue("mailbox_id", mailboxID)
	req.Header.Set("Content-Type", ctBad)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	rec = httptest.NewRecorder()
	attachmentsHandler(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("ciphertext sha mismatch status = %d, want 400, body=%s", rec.Code, rec.Body.String())
	}
	mu.Lock()
	delCount := len(deletedKeys)
	mu.Unlock()
	if delCount == 0 {
		t.Fatalf("expected compensating /api/delete call after ciphertext digest mismatch")
	}
	var orphanExists bool
	_ = db.QueryRow(`SELECT EXISTS (SELECT 1 FROM attachments WHERE id = $1)`, badHashID).Scan(&orphanExists)
	if orphanExists {
		t.Fatalf("failed v2 upload left orphaned row in attachments table")
	}
}

func TestOutboundV2SendScheduleRotationCancelAndInternalLeaseFencing(t *testing.T) {
	db := setupTestDB(t)
	t.Cleanup(func() { _ = db.Close() })

	oldRedis := redisClient
	if os.Getenv("REDIS_ADDR") == "" {
		t.Setenv("REDIS_ADDR", "127.0.0.1:6379")
	}
	initRedis()
	defer func() { redisClient = oldRedis }()
	loadRateLimits()

	var hasV2 bool
	if err := db.QueryRow(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='outbound_queue' AND column_name='attachment_count')`).Scan(&hasV2); err != nil || !hasV2 {
		t.Skip("skipping outbound v2 tests: proposed_070 schema not applied on test DB")
	}

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, orgID, ownerID, "outv2")
	token := createTestSession(t, db, ownerID)
	t.Cleanup(func() {
		_, _ = db.Exec(`DELETE FROM outbound_delivery_attachments WHERE mailbox_id = $1`, mailboxID)
		_, _ = db.Exec(`DELETE FROM outbound_queue WHERE mailbox_id = $1`, mailboxID)
		_, _ = db.Exec(`DELETE FROM scheduled_messages WHERE mailbox_id = $1`, mailboxID)
		_, _ = db.Exec(`DELETE FROM attachments WHERE mailbox_id = $1`, mailboxID)
	})

	// Configure key ring file with epoch 1 (retired), epoch 2 (decrypt_only), and epoch 3 (active)
	pk1 := bytes.Repeat([]byte{0x11}, 32)
	pk2 := bytes.Repeat([]byte{0x22}, 32)
	pk3 := bytes.Repeat([]byte{0x33}, 32)
	keyID1, _ := computeOutboundKeyIDHex(pk1)
	keyID2, _ := computeOutboundKeyIDHex(pk2)
	keyID3, _ := computeOutboundKeyIDHex(pk3)
	ring := OutboundPKRing{
		MinAcceptedEpoch: 2,
		Keys: []OutboundKeyRecord{
			{KeyEpoch: 1, KeyID: keyID1, PublicKeyB64: base64.StdEncoding.EncodeToString(pk1), Status: "retired"},
			{KeyEpoch: 2, KeyID: keyID2, PublicKeyB64: base64.StdEncoding.EncodeToString(pk2), Status: "decrypt_only"},
			{KeyEpoch: 3, KeyID: keyID3, PublicKeyB64: base64.StdEncoding.EncodeToString(pk3), Status: "active"},
		},
	}
	ringBytes, _ := json.Marshal(ring)
	ringPath := filepath.Join(t.TempDir(), "pk_ring.json")
	if err := os.WriteFile(ringPath, ringBytes, 0600); err != nil {
		t.Fatalf("write pk ring: %v", err)
	}
	t.Setenv("OUTBOUND_DELIVERY_PK_RING_FILE", ringPath)
	t.Setenv("INTERNAL_API_KEY", "test-outbound-internal-key")
	t.Setenv("STORAGE_WORKER_INTERNAL_KEY", "test-storage-internal-key")

	// Verify /v1/outbound/pubkey exposes active epoch 3 and min_accepted_epoch 2
	req := httptest.NewRequest(http.MethodGet, "/v1/outbound/pubkey", nil)
	rec := httptest.NewRecorder()
	outboundPubkeyHandler(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("pubkey status = %d, want 200", rec.Code)
	}
	var pubResp OutboundPubkeyDetailResponse
	if err := json.NewDecoder(rec.Body).Decode(&pubResp); err != nil {
		t.Fatalf("decode pubkey resp: %v", err)
	}
	if pubResp.KeyEpoch != 3 || pubResp.KeyID != keyID3 || pubResp.MinAcceptedEpoch != 2 {
		t.Fatalf("unexpected pubkey response: %+v", pubResp)
	}

	// Mock storage worker for blob streaming
	v2AttID := uuid.NewString()
	v2PT := []byte("%PDF-1.7-test-payload")
	v2CT := buildV2CiphertextSample(v2PT)
	v2PTSha := sha256.Sum256(v2PT)
	v2CTSha := sha256.Sum256(v2CT)
	v2StorageKey := "mailboxes/" + mailboxID + "/attachments/" + v2AttID + "/payload.bin"

	mockStorage := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/store" {
			_, _ = io.Copy(io.Discard, r.Body)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"status":"stored"}`))
			return
		}
		if r.URL.Path == "/api/delete" {
			_, _ = io.Copy(io.Discard, r.Body)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"status":"deleted"}`))
			return
		}
		if r.URL.Path == "/api/retrieve-stream" {
			var rr struct {
				MailboxID string `json:"mailbox_id"`
				ObjectKey string `json:"object_key"`
			}
			_ = json.NewDecoder(r.Body).Decode(&rr)
			if rr.MailboxID == mailboxID && rr.ObjectKey == v2StorageKey {
				w.Header().Set("Content-Type", "application/octet-stream")
				w.Header().Set("Content-Length", strconv.Itoa(len(v2CT)))
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write(v2CT)
				return
			}
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		http.Error(w, "not found", http.StatusNotFound)
	}))
	defer mockStorage.Close()
	t.Setenv("STORAGE_WORKER_URL", mockStorage.URL)

	// Insert committed v=1 legacy attachment, oversized v=2 attachment (26 MiB), and valid v=2 attachment directly
	v1AttID := uuid.NewString()
	bigAttID := uuid.NewString()
	schedAttID := uuid.NewString()

	if _, err := db.Exec(`
		INSERT INTO attachments (id, mailbox_id, filename, content_type, size_bytes, storage_key, encrypted, crypto_version, upload_state)
		VALUES ($1, $2, 'legacy.pdf', 'application/pdf', 100, $3, true, 1, 'committed')
	`, v1AttID, mailboxID, "mailboxes/"+mailboxID+"/attachments/"+v1AttID+"/payload.bin"); err != nil {
		t.Fatalf("insert v1 att: %v", err)
	}

	insertV2Row := func(attID, fname, mime string, ptBytes []byte, ctBytes []byte, ptSizeOverride int64) []byte {
		ptSum := sha256.Sum256(ptBytes)
		ctSum := sha256.Sum256(ctBytes)
		ptSize := int64(len(ptBytes))
		if ptSizeOverride > 0 {
			ptSize = ptSizeOverride
		}
		ownerWrap := bytes.Repeat([]byte{0x55}, 81)
		ownerWrap[0] = 0x01
		pkSum := sha256.Sum256(bytes.Repeat([]byte{0x22}, 32))
		_, err := db.Exec(`
			INSERT INTO attachments (
				id, mailbox_id, filename, content_type, size_bytes, storage_key, encrypted,
				crypto_version, cek_owner_wrapped, owner_wrap_alg, owner_key_version, owner_pk_sha256,
				blob_aad_version, plaintext_sha256, ciphertext_sha256, ciphertext_size_bytes, upload_state
			) VALUES ($1, $2, $3, $4, $5, $6, true, 2, $7, $8, 1, $9, 2, $10, $11, $12, 'committed')
		`, attID, mailboxID, fname, mime, ptSize, "mailboxes/"+mailboxID+"/attachments/"+attID+"/payload.bin",
			ownerWrap, AttachmentWrapAlgX25519, pkSum[:], ptSum[:], ctSum[:], ptSize+29)
		if err != nil {
			t.Fatalf("insert v2 row: %v", err)
		}
		return ptSum[:]
	}

	insertV2Row(v2AttID, "report.pdf", "application/pdf", v2PT, v2CT, 0)
	bigPTSha := insertV2Row(bigAttID, "huge.bin", "application/octet-stream", []byte("x"), v2CT, 26*1024*1024)
	schedPT := []byte("scheduled-attachment-bytes")
	schedPTSha := insertV2Row(schedAttID, "later.txt", "text/plain", schedPT, buildV2CiphertextSample(schedPT), 0)

	makeGrant := func(attID, fname, mime string, sz int64, ptSha []byte, epoch int, keyID string) OutboundAttachmentGrantInput {
		meta := canonicalAttachmentMetadataSHA256(fname, mime, sz, ptSha, "attachment", "")
		wrapBytes := bytes.Repeat([]byte{0x77}, 81)
		wrapBytes[0] = 0x01
		return OutboundAttachmentGrantInput{
			AttachmentID:       attID,
			Position:           0,
			Disposition:        "attachment",
			WrapAlg:            AttachmentWrapAlgX25519,
			OutboundKeyID:      keyID,
			OutboundKeyEpoch:   epoch,
			CekOutboundWrapped: base64.StdEncoding.EncodeToString(wrapBytes),
			MetadataSHA256:     hex.EncodeToString(meta),
		}
	}

	prepareRes := func() OutboundPrepareResponse {
		pReq := httptest.NewRequest(http.MethodPost, "/v1/outbound/prepare", strings.NewReader(`{"mailbox_id":"`+mailboxID+`"}`))
		pReq.Header.Set("Content-Type", "application/json")
		pReq.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
		pRec := httptest.NewRecorder()
		outboundPrepareHandler(pRec, pReq)
		if pRec.Code != http.StatusCreated && pRec.Code != http.StatusOK {
			t.Fatalf("prepare status = %d, body=%s", pRec.Code, pRec.Body.String())
		}
		var out OutboundPrepareResponse
		_ = json.NewDecoder(pRec.Body).Decode(&out)
		return out
	}

	postSend := func(payload OutboundSendRequest) *httptest.ResponseRecorder {
		b, _ := json.Marshal(payload)
		sReq := httptest.NewRequest(http.MethodPost, "/v1/outbound/send", bytes.NewReader(b))
		sReq.Header.Set("Content-Type", "application/json")
		sReq.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
		sRec := httptest.NewRecorder()
		outboundSendHandler(sRec, sReq)
		return sRec
	}

	baseReq := func(prep OutboundPrepareResponse) OutboundSendRequest {
		encMsg := make([]byte, 32)
		encMsg[0] = 0x01
		tokBytes := bytes.Repeat([]byte{0x33}, 81)
		tokBytes[0] = 0x01
		return OutboundSendRequest{
			ReservationID:     prep.ReservationID,
			MailboxID:         mailboxID,
			Recipient:         "outside@example.com",
			EncryptedMessage:  base64.StdEncoding.EncodeToString(encMsg),
			SendTokenWrapped:  base64.StdEncoding.EncodeToString(tokBytes),
			OutboxSeq:         prep.OutboxSeq,
			EncryptionVersion: prep.EncryptionVersion,
			AADVersion:        prep.AADVersion,
			EncryptionIV:      base64.StdEncoding.EncodeToString(make([]byte, 12)),
			SendTokenKeyEpoch: 3,
			SendTokenKeyID:    keyID3,
		}
	}

	// Case A: Legacy v=1 attachment rejected on Path B send with 422
	p1 := prepareRes()
	reqV1 := baseReq(p1)
	reqV1.Attachments = []OutboundAttachmentGrantInput{makeGrant(v1AttID, "legacy.pdf", "application/pdf", 100, make([]byte, 32), 3, keyID3)}
	if r := postSend(reqV1); r.Code != http.StatusUnprocessableEntity {
		t.Fatalf("v1 attachment send status = %d, want 422, body=%s", r.Code, r.Body.String())
	}

	// Case B: >25 MiB aggregate attachment rejected with 413
	p2 := prepareRes()
	reqBig := baseReq(p2)
	reqBig.Attachments = []OutboundAttachmentGrantInput{makeGrant(bigAttID, "huge.bin", "application/octet-stream", 26*1024*1024, bigPTSha, 3, keyID3)}
	if r := postSend(reqBig); r.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf(">25MiB attachment send status = %d, want 413, body=%s", r.Code, r.Body.String())
	}

	// Case C: Spoofed metadata_sha256 rejected with 400
	p3 := prepareRes()
	reqSpoof := baseReq(p3)
	gSpoof := makeGrant(v2AttID, "report.pdf", "application/pdf", int64(len(v2PT)), v2PTSha[:], 3, keyID3)
	gSpoof.MetadataSHA256 = strings.Repeat("aa", 32)
	reqSpoof.Attachments = []OutboundAttachmentGrantInput{gSpoof}
	if r := postSend(reqSpoof); r.Code != http.StatusBadRequest {
		t.Fatalf("spoofed metadata_sha256 status = %d, want 400, body=%s", r.Code, r.Body.String())
	}

	// Case D: Retired/stale outbound_key_epoch=1 rejected with 409 (triggers webmail key refresh)
	p4 := prepareRes()
	reqEpoch := baseReq(p4)
	reqEpoch.Attachments = []OutboundAttachmentGrantInput{makeGrant(v2AttID, "report.pdf", "application/pdf", int64(len(v2PT)), v2PTSha[:], 1, keyID1)}
	if r := postSend(reqEpoch); r.Code != http.StatusConflict {
		t.Fatalf("stale key epoch status = %d, want 409, body=%s", r.Code, r.Body.String())
	}

	// Case D2: Grace-period decrypt_only outbound_key_epoch=2 (>= MinAcceptedEpoch=2) is accepted (201)
	graceAttID := uuid.NewString()
	gracePT := []byte("grace-window-attachment")
	graceCT := buildV2CiphertextSample(gracePT)
	gracePTSha := insertV2Row(graceAttID, "grace.txt", "text/plain", gracePT, graceCT, 0)
	p4b := prepareRes()
	reqGrace := baseReq(p4b)
	reqGrace.SendTokenKeyEpoch = 2
	reqGrace.SendTokenKeyID = keyID2
	reqGrace.Attachments = []OutboundAttachmentGrantInput{makeGrant(graceAttID, "grace.txt", "text/plain", int64(len(gracePT)), gracePTSha, 2, keyID2)}
	if rGrace := postSend(reqGrace); rGrace.Code != http.StatusCreated {
		t.Fatalf("grace window decrypt_only epoch send status = %d, want 201, body=%s", rGrace.Code, rGrace.Body.String())
	}

	// Clear only this synthetic test mailbox/org per-minute rate bucket before continuing
	if redisClient != nil {
		nowSec := time.Now().Unix()
		for _, off := range []int64{0, -1, 1} {
			_ = redisClient.Del(context.Background(),
				fmt.Sprintf("rate:mailbox:%s:minute:%d", mailboxID, nowSec/60+off),
				fmt.Sprintf("rate:org:%s:minute:%d", orgID, nowSec/60+off),
			)
		}
	}

	// Case E: Valid v=2 attachment send on active epoch=3 succeeds (201) and tests internal lease fencing
	p5 := prepareRes()
	reqOK := baseReq(p5)
	reqOK.Attachments = []OutboundAttachmentGrantInput{makeGrant(v2AttID, "report.pdf", "application/pdf", int64(len(v2PT)), v2PTSha[:], 3, keyID3)}
	rOK := postSend(reqOK)
	if rOK.Code != http.StatusCreated {
		t.Fatalf("valid v2 send status = %d, want 201, body=%s", rOK.Code, rOK.Body.String())
	}
	var sendResp OutboundSendResponse
	_ = json.NewDecoder(rOK.Body).Decode(&sendResp)
	deliveryID := sendResp.DeliveryID

	// Unauthenticated internal manifest -> 401
	iReq := httptest.NewRequest(http.MethodGet, "/v1/internal/outbound/"+deliveryID+"/attachments", nil)
	iReq.SetPathValue("delivery_id", deliveryID)
	iRec := httptest.NewRecorder()
	internalOutboundAttachmentsHandler(iRec, iReq)
	if iRec.Code != http.StatusUnauthorized {
		t.Fatalf("unauth internal manifest status = %d, want 401", iRec.Code)
	}

	// Valid internal key while status='pending' (no lease) -> 409 Conflict
	leaseTok := uuid.NewString()
	iReq = httptest.NewRequest(http.MethodGet, "/v1/internal/outbound/"+deliveryID+"/attachments", nil)
	iReq.SetPathValue("delivery_id", deliveryID)
	iReq.Header.Set("X-Internal-Key", "test-outbound-internal-key")
	iReq.Header.Set("X-Lease-Token", leaseTok)
	iRec = httptest.NewRecorder()
	internalOutboundAttachmentsHandler(iRec, iReq)
	if iRec.Code != http.StatusConflict {
		t.Fatalf("pending row internal manifest status = %d, want 409", iRec.Code)
	}

	// Claim active lease in DB -> 200 OK manifest + 200 OK blob
	if _, err := db.Exec(`
		UPDATE outbound_queue
		SET status = 'processing', lease_token = $1, lease_expires_at = now() + interval '5 minutes', expires_at = now() + interval '1 hour'
		WHERE delivery_id = $2
	`, leaseTok, deliveryID); err != nil {
		t.Fatalf("claim test lease: %v", err)
	}

	iReq = httptest.NewRequest(http.MethodGet, "/v1/internal/outbound/"+deliveryID+"/attachments", nil)
	iReq.SetPathValue("delivery_id", deliveryID)
	iReq.Header.Set("X-Internal-Key", "test-outbound-internal-key")
	iReq.Header.Set("X-Lease-Token", leaseTok)
	iRec = httptest.NewRecorder()
	internalOutboundAttachmentsHandler(iRec, iReq)
	if iRec.Code != http.StatusOK {
		t.Fatalf("active lease internal manifest status = %d, want 200, body=%s", iRec.Code, iRec.Body.String())
	}

	// Stale lease token -> 409 Conflict
	bReq := httptest.NewRequest(http.MethodGet, "/v1/internal/outbound/"+deliveryID+"/attachments/"+v2AttID+"/blob", nil)
	bReq.SetPathValue("delivery_id", deliveryID)
	bReq.SetPathValue("attachment_id", v2AttID)
	bReq.Header.Set("X-Internal-Key", "test-outbound-internal-key")
	bReq.Header.Set("X-Lease-Token", uuid.NewString())
	bRec := httptest.NewRecorder()
	internalOutboundAttachmentBlobHandler(bRec, bReq)
	if bRec.Code != http.StatusConflict {
		t.Fatalf("stale lease blob status = %d, want 409", bRec.Code)
	}

	// Valid lease blob stream -> 200 OK + exact ciphertext bytes + expected SHA-256 header
	bReq = httptest.NewRequest(http.MethodGet, "/v1/internal/outbound/"+deliveryID+"/attachments/"+v2AttID+"/blob", nil)
	bReq.SetPathValue("delivery_id", deliveryID)
	bReq.SetPathValue("attachment_id", v2AttID)
	bReq.Header.Set("X-Internal-Key", "test-outbound-internal-key")
	bReq.Header.Set("X-Lease-Token", leaseTok)
	bRec = httptest.NewRecorder()
	internalOutboundAttachmentBlobHandler(bRec, bReq)
	if bRec.Code != http.StatusOK {
		t.Fatalf("active lease blob status = %d, want 200, body=%s", bRec.Code, bRec.Body.String())
	}
	if !bytes.Equal(bRec.Body.Bytes(), v2CT) {
		t.Fatalf("streamed blob bytes mismatch")
	}
	if bRec.Header().Get("X-Expected-Ciphertext-Sha256") != hex.EncodeToString(v2CTSha[:]) {
		t.Fatalf("unexpected X-Expected-Ciphertext-Sha256 header: %q", bRec.Header().Get("X-Expected-Ciphertext-Sha256"))
	}

	// Expired delivery -> 410 Gone
	if _, err := db.Exec(`UPDATE outbound_queue SET expires_at = now() - interval '1 minute' WHERE delivery_id = $1`, deliveryID); err != nil {
		t.Fatalf("expire test queue row: %v", err)
	}
	bReq = httptest.NewRequest(http.MethodGet, "/v1/internal/outbound/"+deliveryID+"/attachments", nil)
	bReq.SetPathValue("delivery_id", deliveryID)
	bReq.Header.Set("X-Internal-Key", "test-outbound-internal-key")
	bReq.Header.Set("X-Lease-Token", leaseTok)
	bRec = httptest.NewRecorder()
	internalOutboundAttachmentsHandler(bRec, bReq)
	if bRec.Code != http.StatusGone {
		t.Fatalf("expired delivery manifest status = %d, want 410", bRec.Code)
	}

	// Case F: Schedule + Cancel deletes grant rows cleanly
	p6 := prepareRes()
	schedEncMsg := make([]byte, 32)
	schedEncMsg[0] = 0x01
	schedTokBytes := bytes.Repeat([]byte{0x33}, 81)
	schedTokBytes[0] = 0x01
	schedReqBody := OutboundScheduleRequest{
		ReservationID:     p6.ReservationID,
		MailboxID:         mailboxID,
		Recipient:         "future@example.com",
		EncryptedMessage:  base64.StdEncoding.EncodeToString(schedEncMsg),
		SendTokenWrapped:  base64.StdEncoding.EncodeToString(schedTokBytes),
		OutboxSeq:         p6.OutboxSeq,
		EncryptionVersion: p6.EncryptionVersion,
		AADVersion:        p6.AADVersion,
		EncryptionIV:      base64.StdEncoding.EncodeToString(make([]byte, 12)),
		SendTokenKeyEpoch: 3,
		SendTokenKeyID:    keyID3,
		DraftEnvelope:     base64.StdEncoding.EncodeToString(schedEncMsg),
		ScheduledAt:       time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339),
		Attachments:       []OutboundAttachmentGrantInput{makeGrant(schedAttID, "later.txt", "text/plain", int64(len(schedPT)), schedPTSha, 3, keyID3)},
	}
	sb, _ := json.Marshal(schedReqBody)
	scReq := httptest.NewRequest(http.MethodPost, "/v1/outbound/schedule", bytes.NewReader(sb))
	scReq.Header.Set("Content-Type", "application/json")
	scReq.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	scRec := httptest.NewRecorder()
	outboundScheduleHandler(scRec, scReq)
	if scRec.Code != http.StatusCreated {
		t.Fatalf("schedule v2 status = %d, want 201, body=%s", scRec.Code, scRec.Body.String())
	}
	var schedResp OutboundScheduleResponse
	_ = json.NewDecoder(scRec.Body).Decode(&schedResp)

	var grantCount int
	_ = db.QueryRow(`SELECT COUNT(*) FROM outbound_delivery_attachments WHERE delivery_id = $1`, schedResp.DeliveryID).Scan(&grantCount)
	if grantCount != 1 {
		t.Fatalf("scheduled grantCount = %d, want 1", grantCount)
	}

	cancelPayload, _ := json.Marshal(OutboundScheduledCancelRequest{
		DeliveryID:    schedResp.DeliveryID,
		ReservationID: p6.ReservationID,
	})
	cReq := httptest.NewRequest(http.MethodPost, "/v1/outbound/scheduled/cancel", bytes.NewReader(cancelPayload))
	cReq.Header.Set("Content-Type", "application/json")
	cReq.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	cRec := httptest.NewRecorder()
	outboundScheduledCancelHandler(cRec, cReq)
	if cRec.Code != http.StatusOK {
		t.Fatalf("cancel scheduled status = %d, want 200, body=%s", cRec.Code, cRec.Body.String())
	}
	_ = db.QueryRow(`SELECT COUNT(*) FROM outbound_delivery_attachments WHERE delivery_id = $1`, schedResp.DeliveryID).Scan(&grantCount)
	if grantCount != 0 {
		t.Fatalf("after cancel grantCount = %d, want 0", grantCount)
	}
}

func TestCanonicalMetadataGoldenVectorMatchesRustAndTS(t *testing.T) {
	pt := []byte("BYOS-V2-ATTACHMENT-TEST-VECTOR")
	ptSum := sha256.Sum256(pt)
	meta := canonicalAttachmentMetadataSHA256("quarterly-report.pdf", "application/pdf", int64(len(pt)), ptSum[:], "attachment", "")
	want := "771f01f61c58580ad77d09bc09aacf651f2c6e69d9cc0f317f53bc467eaa4a8d"
	if got := hex.EncodeToString(meta); got != want {
		t.Fatalf("metadata_sha256 = %s, want %s", got, want)
	}
	pk := bytes.Repeat([]byte{0x11}, 32)
	keyID, err := computeOutboundKeyIDHex(pk)
	if err != nil {
		t.Fatalf("computeOutboundKeyIDHex: %v", err)
	}
	if keyID != "2f85927d7d6955b4" {
		t.Fatalf("key_id = %s, want 2f85927d7d6955b4", keyID)
	}
	var unused [8]byte
	binary.BigEndian.PutUint64(unused[:], 42)
}

func TestAttachmentDeleteConflictScopedToActiveDeliveries(t *testing.T) {
	db := setupTestDB(t)
	t.Cleanup(func() { _ = db.Close() })

	var hasV2 bool
	if err := db.QueryRow(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='outbound_queue' AND column_name='attachment_count')`).Scan(&hasV2); err != nil || !hasV2 {
		t.Skip("skipping: proposed_070 schema not applied on test DB")
	}

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, orgID, ownerID, "delconflict")
	token := createTestSession(t, db, ownerID)

	storageSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer storageSrv.Close()
	t.Setenv("STORAGE_WORKER_URL", storageSrv.URL)
	t.Setenv("STORAGE_WORKER_INTERNAL_KEY", "test-storage-key")

	attID := uuid.NewString()
	deliveryID := uuid.NewString()
	t.Cleanup(func() {
		_, _ = db.Exec(`DELETE FROM outbound_delivery_attachments WHERE delivery_id = $1`, deliveryID)
		_, _ = db.Exec(`DELETE FROM outbound_queue WHERE delivery_id = $1`, deliveryID)
		_, _ = db.Exec(`DELETE FROM scheduled_messages WHERE delivery_id = $1`, deliveryID)
		_, _ = db.Exec(`DELETE FROM attachments WHERE id = $1`, attID)
	})

	if _, err := db.Exec(`
		INSERT INTO attachments (id, mailbox_id, storage_key, filename, content_type, size_bytes, encrypted, crypto_version, upload_state, cek_owner_wrapped, owner_wrap_alg, owner_key_version, owner_pk_sha256, blob_aad_version, plaintext_sha256, ciphertext_sha256, ciphertext_size_bytes)
		VALUES ($1, $2, $3, 'doc.pdf', 'application/pdf', 128, true, 2, 'committed', $4, 'HPKE-X25519-AES256GCM-v1', 1, $5, 2, $5, $5, 157)
	`, attID, mailboxID, "mailboxes/"+mailboxID+"/attachments/"+attID+".enc", bytes.Repeat([]byte{0x11}, 81), bytes.Repeat([]byte{0xaa}, 32)); err != nil {
		t.Fatalf("insert attachment: %v", err)
	}

	var domainID string
	_ = db.QueryRow(`SELECT domain_id::text FROM mailboxes WHERE id = $1`, mailboxID).Scan(&domainID)

	// Active outbound_queue row ('pending') -> DELETE returns 409 Conflict
	if _, err := db.Exec(`
		INSERT INTO outbound_queue (delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped, outbox_seq, encryption_version, aad_version, status, expires_at, attachment_count)
		VALUES ($1, $2, $3, 'ext@example.com', '\x01', '\x01', 1, 1, 1, 'pending', now() + interval '1 hour', 1)
	`, deliveryID, mailboxID, domainID); err != nil {
		t.Fatalf("insert outbound_queue: %v", err)
	}
	if _, err := db.Exec(`
		INSERT INTO outbound_delivery_attachments (delivery_id, attachment_id, mailbox_id, outbox_seq, position, disposition, outbound_key_id, outbound_key_epoch, cek_outbound_wrapped, metadata_sha256)
		VALUES ($1, $2, $3, 1, 0, 'attachment', 'key1', 1, $4, $5)
	`, deliveryID, attID, mailboxID, bytes.Repeat([]byte{0xbb}, 81), bytes.Repeat([]byte{0xaa}, 32)); err != nil {
		t.Fatalf("insert grant: %v", err)
	}

	delReq := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodDelete, "/v1/mailboxes/"+mailboxID+"/attachments/"+attID, nil)
		req.SetPathValue("mailbox_id", mailboxID)
		req.SetPathValue("attachment_id", attID)
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
		rec := httptest.NewRecorder()
		attachmentsHandler(rec, req)
		return rec
	}

	if rec := delReq(); rec.Code != http.StatusConflict {
		t.Fatalf("DELETE while outbound_queue queued = %d, want 409, body=%s", rec.Code, rec.Body.String())
	}

	// Mark outbound_queue delivered, and add a pending scheduled_messages row -> still 409 Conflict
	if _, err := db.Exec(`UPDATE outbound_queue SET status = 'delivered' WHERE delivery_id = $1`, deliveryID); err != nil {
		t.Fatalf("mark delivered: %v", err)
	}
	schedRowID := uuid.NewString()
	if _, err := db.Exec(`
		INSERT INTO scheduled_messages (id, delivery_id, mailbox_id, domain_id, recipient, send_token_hash, scheduled_at, expires_at, draft_storage_ref, status)
		VALUES ($1, $2, $3, $4, 'ext@example.com', '\x01', now() + interval '1 hour', now() + interval '24 hours', $5, 'pending')
	`, schedRowID, deliveryID, mailboxID, domainID, "mailboxes/"+mailboxID+"/scheduled/"+schedRowID+".draft.enc"); err != nil {
		t.Fatalf("insert scheduled_messages: %v", err)
	}
	if rec := delReq(); rec.Code != http.StatusConflict {
		t.Fatalf("DELETE while scheduled_messages pending = %d, want 409, body=%s", rec.Code, rec.Body.String())
	}

	// Mark scheduled_messages cancelled (while outbound_queue is already terminal delivered) -> DELETE returns 204 No Content
	if _, err := db.Exec(`UPDATE scheduled_messages SET status = 'cancelled' WHERE id = $1`, schedRowID); err != nil {
		t.Fatalf("cancel scheduled: %v", err)
	}
	if rec := delReq(); rec.Code != http.StatusNoContent {
		t.Fatalf("DELETE after terminal outbound_queue + cancelled scheduled_messages = %d, want 204, body=%s", rec.Code, rec.Body.String())
	}
}

func TestDraftAttachmentsPersistenceAndOwnershipCheck(t *testing.T) {
	db := setupTestDB(t)
	t.Cleanup(func() { _ = db.Close() })

	var hasTable bool
	if err := db.QueryRow(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='draft_attachments')`).Scan(&hasTable); err != nil || !hasTable {
		t.Skip("skipping: draft_attachments table not applied on test DB")
	}

	orgID, ownerID, otherID, _ := createTestOrgAndUsers(t, db)
	_, mailboxA := createTestMailbox(t, db, orgID, ownerID, "drafta")
	_, mailboxB := createTestMailbox(t, db, orgID, otherID, "draftb")
	tokenA := createTestSession(t, db, ownerID)

	att1 := uuid.NewString()
	att2 := uuid.NewString()
	attOther := uuid.NewString()
	t.Cleanup(func() {
		_, _ = db.Exec(`DELETE FROM draft_attachments WHERE mailbox_id IN ($1, $2)`, mailboxA, mailboxB)
		_, _ = db.Exec(`DELETE FROM drafts WHERE mailbox_id IN ($1, $2)`, mailboxA, mailboxB)
		_, _ = db.Exec(`DELETE FROM attachments WHERE id IN ($1, $2, $3)`, att1, att2, attOther)
	})

	for _, pair := range [][2]string{{att1, mailboxA}, {att2, mailboxA}, {attOther, mailboxB}} {
		if _, err := db.Exec(`
			INSERT INTO attachments (id, mailbox_id, storage_key, filename, content_type, size_bytes, encrypted, crypto_version, upload_state, cek_owner_wrapped, owner_wrap_alg, owner_key_version, owner_pk_sha256, blob_aad_version, plaintext_sha256, ciphertext_sha256, ciphertext_size_bytes)
			VALUES ($1, $2, $3, 'f.bin', 'application/octet-stream', 10, true, 2, 'committed', $4, 'HPKE-X25519-AES256GCM-v1', 1, $5, 2, $5, $5, 39)
		`, pair[0], pair[1], "mailboxes/"+pair[1]+"/attachments/"+pair[0]+".enc", bytes.Repeat([]byte{0x11}, 81), bytes.Repeat([]byte{0xaa}, 32)); err != nil {
			t.Fatalf("insert attachment %s: %v", pair[0], err)
		}
	}

	envB64 := base64.StdEncoding.EncodeToString(append([]byte{0x01}, make([]byte, 32)...))
	createBody, _ := json.Marshal(map[string]interface{}{
		"subject":            "",
		"recipient":          "",
		"encrypted_envelope": envB64,
		"attachment_ids":     []string{att1, att2},
	})
	req := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxA+"/drafts", bytes.NewReader(createBody))
	req.SetPathValue("mailbox_id", mailboxA)
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: tokenA})
	rec := httptest.NewRecorder()
	draftsHandler(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create draft status = %d, want 201, body=%s", rec.Code, rec.Body.String())
	}
	var created map[string]interface{}
	_ = json.NewDecoder(rec.Body).Decode(&created)
	draftID, _ := created["id"].(string)
	gotIDs, _ := created["attachment_ids"].([]interface{})
	if len(gotIDs) != 2 || gotIDs[0] != att1 || gotIDs[1] != att2 {
		t.Fatalf("create draft attachment_ids = %v, want [%s %s]", gotIDs, att1, att2)
	}

	// Update omitting attachment_ids preserves existing draft_attachments (backwards-compatibility)
	updateOmit, _ := json.Marshal(map[string]interface{}{
		"encrypted_envelope": envB64,
		"version":            1,
	})
	req = httptest.NewRequest(http.MethodPut, "/v1/mailboxes/"+mailboxA+"/drafts/"+draftID, bytes.NewReader(updateOmit))
	req.SetPathValue("mailbox_id", mailboxA)
	req.SetPathValue("draft_id", draftID)
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: tokenA})
	rec = httptest.NewRecorder()
	draftsHandler(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("update draft omit status = %d, want 200, body=%s", rec.Code, rec.Body.String())
	}
	var updatedOmit map[string]interface{}
	_ = json.NewDecoder(rec.Body).Decode(&updatedOmit)
	gotOmitIDs, _ := updatedOmit["attachment_ids"].([]interface{})
	if len(gotOmitIDs) != 2 {
		t.Fatalf("update draft omitting attachment_ids lost links: %v", gotOmitIDs)
	}

	// Reject cross-mailbox attachment_id
	updateBad, _ := json.Marshal(map[string]interface{}{
		"encrypted_envelope": envB64,
		"attachment_ids":     []string{attOther},
		"version":            2,
	})
	req = httptest.NewRequest(http.MethodPut, "/v1/mailboxes/"+mailboxA+"/drafts/"+draftID, bytes.NewReader(updateBad))
	req.SetPathValue("mailbox_id", mailboxA)
	req.SetPathValue("draft_id", draftID)
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: tokenA})
	rec = httptest.NewRecorder()
	draftsHandler(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("cross-mailbox draft attachment status = %d, want 400, body=%s", rec.Code, rec.Body.String())
	}
}

func TestScheduledCompletionRelinksAttachmentsOnDeliveredAndPreservesDraftOnFailed(t *testing.T) {
	db := setupTestDB(t)
	t.Cleanup(func() { _ = db.Close() })

	var hasV2 bool
	if err := db.QueryRow(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='draft_attachments')`).Scan(&hasV2); err != nil || !hasV2 {
		t.Skip("skipping: draft_attachments table not applied on test DB")
	}

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, orgID, ownerID, "schedcomp")
	var domainID string
	_ = db.QueryRow(`SELECT domain_id::text FROM mailboxes WHERE id = $1`, mailboxID).Scan(&domainID)

	storageSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/retrieve" {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer storageSrv.Close()
	t.Setenv("STORAGE_WORKER_URL", storageSrv.URL)
	t.Setenv("STORAGE_WORKER_INTERNAL_KEY", "test-storage-key")

	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("missing DSN")
	}

	delDelivered := uuid.NewString()
	delFailed := uuid.NewString()
	attDelivered := uuid.NewString()
	attFailed := uuid.NewString()
	schedDelivered := uuid.NewString()
	schedFailed := uuid.NewString()
	t.Cleanup(func() {
		_, _ = db.Exec(`DELETE FROM draft_attachments WHERE mailbox_id = $1`, mailboxID)
		_, _ = db.Exec(`DELETE FROM drafts WHERE mailbox_id = $1`, mailboxID)
		_, _ = db.Exec(`DELETE FROM outbound_delivery_attachments WHERE mailbox_id = $1`, mailboxID)
		_, _ = db.Exec(`DELETE FROM scheduled_messages WHERE mailbox_id = $1`, mailboxID)
		_, _ = db.Exec(`DELETE FROM attachments WHERE mailbox_id = $1`, mailboxID)
		_, _ = db.Exec(`DELETE FROM messages WHERE mailbox_id = $1`, mailboxID)
	})

	for _, pair := range [][2]string{{attDelivered, delDelivered}, {attFailed, delFailed}} {
		if _, err := db.Exec(`
			INSERT INTO attachments (id, mailbox_id, message_id, storage_key, filename, content_type, size_bytes, encrypted, crypto_version, upload_state, cek_owner_wrapped, owner_wrap_alg, owner_key_version, owner_pk_sha256, blob_aad_version, plaintext_sha256, ciphertext_sha256, ciphertext_size_bytes)
			VALUES ($1, $2, $3, $4, 'sched.pdf', 'application/pdf', 64, true, 2, 'committed', $5, 'HPKE-X25519-AES256GCM-v1', 1, $6, 2, $6, $6, 93)
		`, pair[0], mailboxID, pair[1], "mailboxes/"+mailboxID+"/attachments/"+pair[0]+".enc", bytes.Repeat([]byte{0x11}, 81), bytes.Repeat([]byte{0xaa}, 32)); err != nil {
			t.Fatalf("insert attachment: %v", err)
		}
		if _, err := db.Exec(`
			INSERT INTO outbound_delivery_attachments (delivery_id, attachment_id, mailbox_id, outbox_seq, position, disposition, outbound_key_id, outbound_key_epoch, cek_outbound_wrapped, metadata_sha256)
			VALUES ($1, $2, $3, 1, 0, 'attachment', 'key1', 1, $4, $5)
		`, pair[1], pair[0], mailboxID, bytes.Repeat([]byte{0xbb}, 81), bytes.Repeat([]byte{0xaa}, 32)); err != nil {
			t.Fatalf("insert grant: %v", err)
		}
	}
	for _, pair := range [][2]string{{schedDelivered, delDelivered}, {schedFailed, delFailed}} {
		if _, err := db.Exec(`
			INSERT INTO scheduled_messages (id, delivery_id, mailbox_id, domain_id, recipient, send_token_hash, scheduled_at, expires_at, draft_storage_ref, status)
			VALUES ($1, $2, $3, $4, 'dest@example.com', '\x01', now(), now() + interval '24 hours', $5, 'pending')
		`, pair[0], pair[1], mailboxID, domainID, "mailboxes/"+mailboxID+"/scheduled/"+pair[0]+".draft.enc"); err != nil {
			t.Fatalf("insert scheduled_message: %v", err)
		}
	}

	if err := completeScheduledDelivery(context.Background(), dsn, delDelivered, "delivered", ""); err != nil {
		t.Fatalf("completeScheduledDelivery(delivered): %v", err)
	}
	var linkedMsgID string
	if err := db.QueryRow(`SELECT message_id::text FROM attachments WHERE id = $1`, attDelivered).Scan(&linkedMsgID); err != nil {
		t.Fatalf("query delivered attachment message_id: %v", err)
	}
	if linkedMsgID == delDelivered || linkedMsgID == "" {
		t.Fatalf("delivered attachment message_id = %q, want sent messages.id != delivery_id", linkedMsgID)
	}

	if err := completeScheduledDelivery(context.Background(), dsn, delFailed, "failed", "smtp bounce"); err != nil {
		t.Fatalf("completeScheduledDelivery(failed): %v", err)
	}
	var failedMsgID *string
	if err := db.QueryRow(`SELECT message_id::text FROM attachments WHERE id = $1`, attFailed).Scan(&failedMsgID); err != nil {
		t.Fatalf("query failed attachment message_id: %v", err)
	}
	if failedMsgID != nil {
		t.Fatalf("failed attachment message_id = %v, want NULL", *failedMsgID)
	}
	var draftAttCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM draft_attachments WHERE attachment_id = $1 AND mailbox_id = $2`, attFailed, mailboxID).Scan(&draftAttCount); err != nil || draftAttCount != 1 {
		t.Fatalf("draft_attachments count for failed scheduled attachment = %d (err=%v), want 1", draftAttCount, err)
	}
}

func TestRecoveryRotationIncrementsMailboxSkVersion(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	var hasCol bool
	if err := db.QueryRow(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mailboxes' AND column_name='mailbox_sk_version')`).Scan(&hasCol); err != nil || !hasCol {
		t.Skip("skipping: mailbox_sk_version column not applied on test DB")
	}

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, orgID, ownerID, "skrot")

	challengeTok := uuid.NewString()
	otp := "123456"
	cfg := getOTPDeliveryConfig()
	storedHMAC := ComputeOTPHMAC(cfg.HMACSecret, challengeTok, otp)
	if _, err := db.Exec(`
		INSERT INTO auth_challenges (user_id, challenge_token, challenge_type, verification_code, expires_at)
		VALUES ($1, $2, 'recovery_reset', $3, now() + interval '10 minutes')
	`, ownerID, challengeTok, storedHMAC); err != nil {
		t.Fatalf("insert auth_challenge: %v", err)
	}

	newPkHex := hex.EncodeToString(bytes.Repeat([]byte{0x44}, 32))
	resetBody, _ := json.Marshal(map[string]string{
		"challenge_token":     challengeTok,
		"code":                otp,
		"new_password":        "NewStrongPassword!123",
		"new_mailbox_pk":      newPkHex,
		"new_wrapped_sk_user": "v2:wrapped_rotated_test",
	})
	req := httptest.NewRequest(http.MethodPost, "/v1/auth/recovery/reset-password", bytes.NewReader(resetBody))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	recoveryFlowResetPasswordHandler(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("recovery reset status = %d, want 200, body=%s", rec.Code, rec.Body.String())
	}

	var skVer int
	if err := db.QueryRow(`SELECT mailbox_sk_version FROM mailboxes WHERE id = $1`, mailboxID).Scan(&skVer); err != nil {
		t.Fatalf("query mailbox_sk_version: %v", err)
	}
	if skVer != 2 {
		t.Fatalf("mailbox_sk_version after mailbox_pk rotation = %d, want 2", skVer)
	}
}

func TestInternalOutboundBlobStreamsActualContentLength(t *testing.T) {
	db := setupTestDB(t)
	t.Cleanup(func() { _ = db.Close() })

	var hasV2 bool
	if err := db.QueryRow(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='outbound_queue' AND column_name='attachment_count')`).Scan(&hasV2); err != nil || !hasV2 {
		t.Skip("skipping: proposed_070 schema not applied on test DB")
	}

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, orgID, ownerID, "bloblen")
	var domainID string
	_ = db.QueryRow(`SELECT domain_id::text FROM mailboxes WHERE id = $1`, mailboxID).Scan(&domainID)

	truncatedBlob := []byte("TRUNCATED-12")
	storageSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/retrieve-stream" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Length", strconv.Itoa(len(truncatedBlob)))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(truncatedBlob)
	}))
	defer storageSrv.Close()

	t.Setenv("STORAGE_WORKER_URL", storageSrv.URL)
	t.Setenv("STORAGE_WORKER_INTERNAL_KEY", "test-storage-key")
	t.Setenv("INTERNAL_API_KEY", "test-outbound-internal-key")

	attID := uuid.NewString()
	deliveryID := uuid.NewString()
	leaseTok := uuid.NewString()
	t.Cleanup(func() {
		_, _ = db.Exec(`DELETE FROM outbound_delivery_attachments WHERE delivery_id = $1`, deliveryID)
		_, _ = db.Exec(`DELETE FROM outbound_queue WHERE delivery_id = $1`, deliveryID)
		_, _ = db.Exec(`DELETE FROM attachments WHERE id = $1`, attID)
	})

	if _, err := db.Exec(`
		INSERT INTO attachments (id, mailbox_id, storage_key, filename, content_type, size_bytes, encrypted, crypto_version, upload_state, cek_owner_wrapped, owner_wrap_alg, owner_key_version, owner_pk_sha256, blob_aad_version, plaintext_sha256, ciphertext_sha256, ciphertext_size_bytes)
		VALUES ($1, $2, $3, 'tamper.txt', 'text/plain', 71, true, 2, 'committed', $4, 'HPKE-X25519-AES256GCM-v1', 1, $5, 2, $5, $5, 100)
	`, attID, mailboxID, "mailboxes/"+mailboxID+"/attachments/"+attID+".enc", bytes.Repeat([]byte{0x11}, 81), bytes.Repeat([]byte{0xaa}, 32)); err != nil {
		t.Fatalf("insert attachment: %v", err)
	}
	if _, err := db.Exec(`
		INSERT INTO outbound_queue (delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped, outbox_seq, encryption_version, aad_version, status, lease_token, lease_expires_at, expires_at, attachment_count)
		VALUES ($1, $2, $3, 'ext@example.com', '\x01', '\x01', 1, 1, 1, 'processing', $4, now() + interval '5 minutes', now() + interval '1 hour', 1)
	`, deliveryID, mailboxID, domainID, leaseTok); err != nil {
		t.Fatalf("insert outbound_queue: %v", err)
	}
	if _, err := db.Exec(`
		INSERT INTO outbound_delivery_attachments (delivery_id, attachment_id, mailbox_id, outbox_seq, position, disposition, outbound_key_id, outbound_key_epoch, cek_outbound_wrapped, metadata_sha256)
		VALUES ($1, $2, $3, 1, 0, 'attachment', 'key1', 1, $4, $5)
	`, deliveryID, attID, mailboxID, bytes.Repeat([]byte{0xbb}, 81), bytes.Repeat([]byte{0xaa}, 32)); err != nil {
		t.Fatalf("insert grant: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/internal/outbound/{delivery_id}/attachments/{attachment_id}/blob", internalOutboundAttachmentBlobHandler)
	apiSrv := httptest.NewServer(mux)
	defer apiSrv.Close()

	req, _ := http.NewRequest(http.MethodGet, apiSrv.URL+"/v1/internal/outbound/"+deliveryID+"/attachments/"+attID+"/blob", nil)
	req.Header.Set("X-Internal-Key", "test-outbound-internal-key")
	req.Header.Set("X-Lease-Token", leaseTok)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("HTTP GET blob failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("blob status = %d, want 200", resp.StatusCode)
	}
	got, readErr := io.ReadAll(resp.Body)
	if readErr != nil {
		t.Fatalf("io.ReadAll(resp.Body) error (HTTP framing mismatch): %v", readErr)
	}
	if !bytes.Equal(got, truncatedBlob) {
		t.Fatalf("got %q, want %q", got, truncatedBlob)
	}
}
