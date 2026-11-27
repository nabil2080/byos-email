package main

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func TestPhase2_MessageID_ThreadingSafetyMatrix(t *testing.T) {
	_, pool := setupTestApp(t)
	if pool == nil {
		t.Skip("skipping test; database pool not available")
		return
	}
	ctx := context.Background()

	_, mailboxID, _, _, mailboxEmail := setupMailboxAndAlias(t, pool, "threadc62", true)
	var domainID string
	err := pool.QueryRow(ctx, "SELECT domain_id::text FROM mailboxes WHERE id = $1", mailboxID).Scan(&domainID)
	if err != nil {
		t.Fatalf("query domain_id: %v", err)
	}

	tx, err := pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}
	defer tx.Rollback(ctx)

	insertMsg := func(seq int, msgID, threadID string, receivedAt time.Time) {
		delId := make([]byte, 32)
		copy(delId, []byte(uuid.New().String()[:32]))
		iv := make([]byte, 12)
		bundleHash := make([]byte, 32)
		wrappedKey := make([]byte, 80)
		_, err := tx.Exec(ctx, `
			INSERT INTO message_metadata (
				mailbox_id, domain_id, message_seq, direction, sender, recipients,
				storage_object_id, content_key_hpke_wrapped, wrapped_key_algorithm,
				mailbox_sk_version, encryption_version, encryption_iv, aad_version, bundle_hash,
				status, message_id, thread_id, received_at, delivery_identity
			) VALUES (
				$1::uuid, $2::uuid, $3, 'received', 'sender@example.com', ARRAY[$4],
				$5, $6, 'HPKE-X25519-AES256GCM-v1',
				1, 1, $7, 1, $8,
				'received', $9, $10::uuid, $11, $12
			)
		`, mailboxID, domainID, seq, mailboxEmail, "mailboxes/"+mailboxID+"/"+uuid.New().String()+".enc", wrappedKey, iv, bundleHash, msgID, threadID, receivedAt, delId)
		if err != nil {
			t.Fatalf("insert message %s: %v", msgID, err)
		}
	}

	// 1. Exact Message-ID match
	threadID1 := uuid.New().String()
	insertMsg(101, "ExactMatch-123@domain.org", threadID1, time.Now().Add(-60*time.Minute))

	gotTid, err := ComputeThreadID(ctx, tx, mailboxID, "<ExactMatch-123@domain.org>", "")
	if err != nil {
		t.Fatalf("Scenario 1 failed: %v", err)
	}
	if gotTid != threadID1 {
		t.Fatalf("Scenario 1: expected %s, got %s", threadID1, gotTid)
	}

	// 2. Two records with identifiers differing only in casing
	threadIDA := uuid.New().String()
	threadIDB := uuid.New().String()
	insertMsg(102, "CaseA-Target@domain.org", threadIDA, time.Now().Add(-50*time.Minute))
	insertMsg(103, "casea-target@domain.org", threadIDB, time.Now().Add(-45*time.Minute))

	gotTidA, err := ComputeThreadID(ctx, tx, mailboxID, "<CaseA-Target@domain.org>", "")
	if err != nil || gotTidA != threadIDA {
		t.Fatalf("Scenario 2a: expected %s, got %s (err: %v)", threadIDA, gotTidA, err)
	}
	gotTidB, err := ComputeThreadID(ctx, tx, mailboxID, "<casea-target@domain.org>", "")
	if err != nil || gotTidB != threadIDB {
		t.Fatalf("Scenario 2b: expected %s, got %s (err: %v)", threadIDB, gotTidB, err)
	}

	// 3. Exact match and case-variant match both existing
	threadID3Exact := uuid.New().String()
	threadID3Variant := uuid.New().String()
	insertMsg(104, "MixedTarget-Unique@domain.org", threadID3Exact, time.Now().Add(-40*time.Minute))
	insertMsg(105, "mixedtarget-unique@domain.org", threadID3Variant, time.Now().Add(-35*time.Minute))

	gotTid3, err := ComputeThreadID(ctx, tx, mailboxID, "MixedTarget-Unique@domain.org", "")
	if err != nil || gotTid3 != threadID3Exact {
		t.Fatalf("Scenario 3: exact match must take priority, expected %s, got %s (err: %v)", threadID3Exact, gotTid3, err)
	}

	// 4. Only a case-variant match existing (single candidate safely inherits)
	threadID4 := uuid.New().String()
	insertMsg(106, "SoleCaseVariant-XYZ@domain.org", threadID4, time.Now().Add(-30*time.Minute))

	gotTid4, err := ComputeThreadID(ctx, tx, mailboxID, "<solecasevariant-xyz@domain.org>", "")
	if err != nil || gotTid4 != threadID4 {
		t.Fatalf("Scenario 4: sole case-variant should inherit thread, expected %s, got %s (err: %v)", threadID4, gotTid4, err)
	}

	// 5. Historical records created before C6.1 (lowercased in DB, uppercase reply)
	threadID5 := uuid.New().String()
	insertMsg(107, "legacy-pre-c6-msgid-789@domain.org", threadID5, time.Now().Add(-25*time.Minute))

	gotTid5, err := ComputeThreadID(ctx, tx, mailboxID, "<LEGACY-PRE-C6-MSGID-789@DOMAIN.ORG>", "")
	if err != nil || gotTid5 != threadID5 {
		t.Fatalf("Scenario 5: pre-C6 historical lowercased message should be threaded safely, expected %s, got %s (err: %v)", threadID5, gotTid5, err)
	}

	// 6. Multiple candidate matches:
	// 6a: Multiple candidates belonging to the SAME thread -> safely inherit that thread
	threadID6Same := uuid.New().String()
	insertMsg(108, "SameThread-A@domain.org", threadID6Same, time.Now().Add(-20*time.Minute))
	insertMsg(109, "samethread-a@domain.org", threadID6Same, time.Now().Add(-15*time.Minute))

	gotTid6a, err := ComputeThreadID(ctx, tx, mailboxID, "<SAMETHREAD-A@DOMAIN.ORG>", "")
	if err != nil || gotTid6a != threadID6Same {
		t.Fatalf("Scenario 6a: multiple candidates sharing same thread should succeed, expected %s, got %s (err: %v)", threadID6Same, gotTid6a, err)
	}

	// 6b: Multiple candidates belonging to DIFFERENT threads -> AMBIGUOUS! Refuse to merge (returns "")
	threadID6Diff1 := uuid.New().String()
	threadID6Diff2 := uuid.New().String()
	insertMsg(110, "AmbiguousConflict-1@domain.org", threadID6Diff1, time.Now().Add(-10*time.Minute))
	insertMsg(111, "ambiguousconflict-1@domain.org", threadID6Diff2, time.Now().Add(-8*time.Minute))

	gotTid6b, err := ComputeThreadID(ctx, tx, mailboxID, "<AMBIGUOUSCONFLICT-1@DOMAIN.ORG>", "")
	if err != nil {
		t.Fatalf("Scenario 6b unexpected error: %v", err)
	}
	if gotTid6b != "" {
		t.Fatalf("Scenario 6b: ambiguous match across conflicting threads MUST NOT merge; expected empty string, got %s", gotTid6b)
	}

	// 7. Malformed and ambiguous identifiers
	gotTid7Empty, err := ComputeThreadID(ctx, tx, mailboxID, "<>", "")
	if err != nil || gotTid7Empty != "" {
		t.Fatalf("Scenario 7 empty: expected empty, got %s (err: %v)", gotTid7Empty, err)
	}
	gotTid7Whitespace, err := ComputeThreadID(ctx, tx, mailboxID, "   ", "")
	if err != nil || gotTid7Whitespace != "" {
		t.Fatalf("Scenario 7 whitespace: expected empty, got %s (err: %v)", gotTid7Whitespace, err)
	}
	gotTid7NonExistent, err := ComputeThreadID(ctx, tx, mailboxID, "<nonexistent-msgid@domain.org>", "")
	if err != nil || gotTid7NonExistent != "" {
		t.Fatalf("Scenario 7 non-existent: expected empty, got %s (err: %v)", gotTid7NonExistent, err)
	}

	// 8. In-Reply-To and References matching hierarchy
	// In-Reply-To matches threadID1
	refThread := uuid.New().String()
	insertMsg(112, "RefMsg-1@domain.org", refThread, time.Now().Add(-5*time.Minute))

	gotTid8InReply, err := ComputeThreadID(ctx, tx, mailboxID, "<ExactMatch-123@domain.org>", "<RefMsg-1@domain.org>")
	if err != nil || gotTid8InReply != threadID1 {
		t.Fatalf("Scenario 8: In-Reply-To takes priority over References, expected %s, got %s (err: %v)", threadID1, gotTid8InReply, err)
	}

	// In-Reply-To non-existent, fallback to References
	gotTid8RefFallback, err := ComputeThreadID(ctx, tx, mailboxID, "<nonexistent@domain.org>", "<ExactMatch-123@domain.org> <RefMsg-1@domain.org>")
	if err != nil || gotTid8RefFallback != refThread {
		t.Fatalf("Scenario 8: References newest candidate takes priority, expected %s, got %s (err: %v)", refThread, gotTid8RefFallback, err)
	}
}
