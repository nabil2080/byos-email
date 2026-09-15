package main

// Evidence:
// - services/api/api_test.go: 6 binding tests (verified 6/6 pre-corruption):
//   TestMemberCannotChangeRole, TestOwnerCannotSelfDemote,
//   TestOwnerCannotSelfTerminate, TestAdminCannotChangeRole,
//   TestAdminCannotTerminate, TestMemberCannotTerminate.
//   Handler contracts asserted: PATCH /v1/auth/change-member-role with JSON
//   {target_user_id,new_role}; DELETE /v1/auth/terminate-user with JSON
//   {target_user_id,reason}; session-cookie auth; member/admin change-role ->
//   403; owner self-demote -> 400; owner self-terminate -> 400;
//   admin/member terminate -> 403.
// - infra/postgres/init/010_rbac_roles.sql: users.role + users_role_check
//   (owner/admin/member).
// - Route table: PATCH change-member-role, DELETE terminate-user,
//   GET organization-members.
// - api.exe symbols: hasRole, isAdmin, changeMemberRoleHandler,
//   terminateUserHandler, organizationMembersHandler, auditLog.
// - checkAuth/isOwner/isMember/hashToken: inspected in pre-corruption source;
//   absent from api.exe symbol table (consistent with inlining or linker
//   dead-code elimination); preserved for fidelity, behavior unchanged.

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/jackc/pgx/v5"
)

func hasRole(userID, orgID, role string, conn *pgx.Conn) bool {
	var count int
	err := conn.QueryRow(context.Background(),
		`SELECT count(*) FROM users WHERE id=$1 AND org_id=$2 AND role=$3 AND is_active=true`, userID, orgID, role).Scan(&count)
	if err != nil || count == 0 {
		return false
	}
	return true
}

func isOwner(userID, orgID string, conn *pgx.Conn) bool {
	return hasRole(userID, orgID, "owner", conn)
}

func isAdmin(userID, orgID string, conn *pgx.Conn) bool {
	var count int
	err := conn.QueryRow(context.Background(),
		`SELECT count(*) FROM users WHERE id=$1 AND org_id=$2 AND role IN ('admin', 'owner') AND is_active=true`, userID, orgID).Scan(&count)
	return err == nil && count > 0
}

func isMember(userID, orgID string, conn *pgx.Conn) bool {
	var role string
	err := conn.QueryRow(context.Background(), `SELECT role FROM users WHERE id=$1 AND org_id=$2 AND is_active=true`, userID, orgID).Scan(&role)
	if err != nil {
		return false
	}
	return roleRank(role) >= 1
}

func roleRank(role string) int {
	switch role {
	case "owner":
		return 3
	case "admin":
		return 2
	case "member":
		return 1
	default:
		return 0
	}
}

func checkAuth(ctx context.Context, w http.ResponseWriter, r *http.Request, allowedRoles ...string) bool {
	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "missing or invalid X-User-Id", http.StatusUnauthorized)
		return false
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	var c context.Context
	c = context.Background()
	conn, err := pgx.Connect(c, dsn)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return false
	}
	defer conn.Close(c)

	// Fetch user's organization and role from the database
	var orgID, actualRole string
	err = conn.QueryRow(ctx, `SELECT org_id::text, role FROM users WHERE id=$1 AND is_active=true`, userID).Scan(&orgID, &actualRole)
	if err != nil {
		http.Error(w, "user not found or not a member of any organization", http.StatusForbidden)
		return false
	}

	if !isAuthenticatedForOrg(userID, orgID, conn) {
		http.Error(w, "user not a member of this organization", http.StatusForbidden)
		return false
	}

	if len(allowedRoles) == 0 {
		http.Error(w, "insufficient role for this operation", http.StatusForbidden)
		return false
	}

	actualRank := roleRank(actualRole)
	// Higher role satisfies lower requirement: owner(3) >= admin(2) >= member(1).
	// Endpoint must declare the minimum required rank. If allowedRoles contains
	// "member", everyone passes; if it contains "admin", admin and owner pass.
	requiredRank := 100
	for _, allowed := range allowedRoles {
		if r := roleRank(allowed); r != 0 && r < requiredRank {
			requiredRank = r
		}
	}
	if requiredRank == 100 {
		http.Error(w, "insufficient role for this operation", http.StatusForbidden)
		return false
	}

	if actualRank < requiredRank {
		http.Error(w, "insufficient role for this operation", http.StatusForbidden)
		return false
	}

	return true
}

func auditLog(ctx context.Context, conn *pgx.Conn, orgID, userID, action, resourceType, resourceID string, details map[string]interface{}) {
	if orgID == "" {
		return
	}
	var detailsJSON []byte
	if details != nil {
		detailsJSON, _ = json.Marshal(details)
	}
	var uid *string
	if userID != "" {
		uid = &userID
	}
	var rid *string
	if resourceID != "" {
		rid = &resourceID
	}
	_, _ = conn.Exec(ctx, `INSERT INTO audit_log (org_id, user_id, action, resource_type, resource_id, details) VALUES ($1, $2, $3, $4, $5, $6)`, orgID, uid, action, resourceType, rid, detailsJSON)
}

func organizationMembersHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "missing or invalid X-User-Id", http.StatusUnauthorized)
		return
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	// Fetch actor organization from server-side state.
	var orgID string
	err = conn.QueryRow(ctx, `SELECT org_id::text FROM users WHERE id=$1 AND is_active=true`, userID).Scan(&orgID)
	if err != nil {
		http.Error(w, "user not found or not a member of any organization", http.StatusForbidden)
		return
	}

	if r.Method == http.MethodGet {
		rows, err := conn.Query(ctx, `
			SELECT u.id::text, u.email, COALESCE(u.display_name,''), u.role, u.is_active,
			       EXISTS(SELECT 1 FROM mailboxes m WHERE m.user_id = u.id AND m.is_active = true) as has_mailbox
			FROM users u
			WHERE u.org_id=$1
			ORDER BY (u.role='owner') DESC, (u.role='admin') DESC, u.email
		`, orgID)
		if err != nil {
			http.Error(w, "failed to list members", http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		members := []map[string]interface{}{}
		for rows.Next() {
			var id, email, displayName, role string
			var active, hasMailbox bool
			if err := rows.Scan(&id, &email, &displayName, &role, &active, &hasMailbox); err != nil {
				continue
			}
			members = append(members, map[string]interface{}{
				"id":           id,
				"email":        email,
				"display_name": displayName,
				"role":         role,
				"is_active":    active,
				"has_mailbox":  hasMailbox,
			})
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"members": members})
		return
	}

	if r.Method == http.MethodPost {
		if !isAdmin(userID, orgID, conn) {
			http.Error(w, "admin or owner role required to invite members", http.StatusForbidden)
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		var req struct {
			Email       string `json:"email"`
			Role        string `json:"role"`
			DisplayName string `json:"display_name"`
			Password    string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		email := strings.TrimSpace(strings.ToLower(req.Email))
		if email == "" || !strings.Contains(email, "@") {
			http.Error(w, "valid email required", http.StatusBadRequest)
			return
		}
		role := strings.TrimSpace(req.Role)
		if role != "admin" && role != "member" {
			role = "admin"
		}
		displayName := strings.TrimSpace(req.DisplayName)
		if displayName == "" {
			displayName = strings.Split(email, "@")[0]
		}

		var existingID string
		err = conn.QueryRow(ctx, `SELECT id::text FROM users WHERE email=$1`, email).Scan(&existingID)
		if err == nil {
			http.Error(w, "user with this email already exists", http.StatusConflict)
			return
		}

		pass := req.Password
		if pass == "" {
			passBytes := make([]byte, 12)
			_, _ = rand.Read(passBytes)
			pass = "BYOS!" + hex.EncodeToString(passBytes)
		} else if len(pass) < 8 {
			http.Error(w, "password must be at least 8 characters", http.StatusBadRequest)
			return
		}
		pwHash, err := hashPassword(pass)
		if err != nil {
			http.Error(w, "failed to hash password", http.StatusInternalServerError)
			return
		}

		var newUserID string
		err = conn.QueryRow(ctx, `
			INSERT INTO users (org_id, email, display_name, password_hash, role, status, is_active)
			VALUES ($1, $2, $3, $4, $5, 'active', true)
			RETURNING id::text
		`, orgID, email, displayName, pwHash, role).Scan(&newUserID)
		if err != nil {
			http.Error(w, "failed to create user", http.StatusInternalServerError)
			return
		}

		auditLog(ctx, conn, orgID, userID, "member_invite", "user", newUserID, map[string]interface{}{
			"email": email,
			"role":  role,
		})

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"id":            newUserID,
			"email":         email,
			"display_name":  displayName,
			"role":          role,
			"temp_password": pass,
			"success":       true,
		})
		return
	}
}

func changeMemberRoleHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "missing or invalid X-User-Id", http.StatusUnauthorized)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)

	var req struct {
		TargetUserID string `json:"target_user_id"`
		NewRole      string `json:"new_role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	// Fetch user's organization from the database
	var orgID string
	err = conn.QueryRow(ctx, `SELECT org_id::text FROM users WHERE id=$1 AND is_active=true`, userID).Scan(&orgID)
	if err != nil {
		http.Error(w, "user not found or not a member of any organization", http.StatusForbidden)
		return
	}

	// Check authorization: only owner can change roles
	if !isOwner(userID, orgID, conn) {
		http.Error(w, "only owner can change member roles", http.StatusForbidden)
		return
	}

	// Prevent owner self-demotion
	if req.TargetUserID == userID && req.NewRole != "owner" {
		http.Error(w, "cannot demote yourself to non-owner role", http.StatusBadRequest)
		return
	}

	// Validate role
	if req.NewRole != "owner" && req.NewRole != "admin" && req.NewRole != "member" {
		http.Error(w, "invalid role", http.StatusBadRequest)
		return
	}

	_, err = conn.Exec(ctx, `UPDATE users SET role=$1 WHERE id=$2 AND org_id=$3`, req.NewRole, req.TargetUserID, orgID)
	if err != nil {
		http.Error(w, "failed to update member role", http.StatusInternalServerError)
		return
	}
	// Audit role change
	var actorOrgID string
	err = conn.QueryRow(ctx, `SELECT org_id::text FROM users WHERE id=$1`, userID).Scan(&actorOrgID)
	if err != nil {
		actorOrgID = ""
	}
	auditLog(ctx, conn, actorOrgID, userID, "role_change", "user", req.TargetUserID, map[string]interface{}{"new_role": req.NewRole, "target_user_id": req.TargetUserID})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"id": req.TargetUserID, "new_role": req.NewRole})
}

func terminateUserHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "missing or invalid X-User-Id", http.StatusUnauthorized)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)

	var req struct {
		TargetUserID string `json:"target_user_id"`
		Reason       string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	// Fetch user's organization from server-side authenticated state.
	// (The route carries no org_id path parameter.)
	var orgID string
	err = conn.QueryRow(ctx, `SELECT org_id::text FROM users WHERE id=$1 AND is_active=true`, userID).Scan(&orgID)
	if err != nil {
		http.Error(w, "user not found or not a member of any organization", http.StatusForbidden)
		return
	}

	// Check authorization: only owner can terminate users
	if !isOwner(userID, orgID, conn) {
		http.Error(w, "only owner can terminate users", http.StatusForbidden)
		return
	}

	// Cannot terminate yourself (use deactivation instead, or contact superadmin)
	if req.TargetUserID == userID {
		http.Error(w, "cannot terminate yourself", http.StatusBadRequest)
		return
	}

	// Mark user as inactive. The update is scoped to the actor's org so one
	// organization's owner cannot terminate another organization's users.
	res, err := conn.Exec(ctx, `UPDATE users SET is_active=false WHERE id=$1 AND org_id=$2`, req.TargetUserID, orgID)
	if err != nil {
		http.Error(w, "failed to terminate user", http.StatusInternalServerError)
		return
	}
	if res.RowsAffected() == 0 {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}
	// Audit termination
	var actorOrgID string
	err = conn.QueryRow(ctx, `SELECT org_id::text FROM users WHERE id=$1`, userID).Scan(&actorOrgID)
	if err != nil {
		actorOrgID = ""
	}
	auditLog(ctx, conn, actorOrgID, userID, "terminate_user", "user", req.TargetUserID, map[string]interface{}{"reason": req.Reason})
	// Revoke all sessions for the terminated user so existing sessions
	// become unusable immediately.
	_, err = conn.Exec(ctx, `UPDATE sessions SET revoked_at=now() WHERE user_id=$1`, req.TargetUserID)
	if err != nil {
		log.Printf("failed to revoke sessions for terminated user %s: %v", req.TargetUserID, err)
	}
	// Revoke all bridge credentials for the terminated user's mailboxes (Section 1).
	_, err = conn.Exec(ctx, `UPDATE bridge_credentials SET revoked_at=now() WHERE mailbox_id IN (SELECT id FROM mailboxes WHERE user_id=$1) AND revoked_at IS NULL`, req.TargetUserID)
	if err != nil {
		log.Printf("failed to revoke bridge credentials for terminated user %s: %v", req.TargetUserID, err)
	}
	// Revoke all device-mailbox access for devices owned by the terminated user (Section 1).
	_, err = conn.Exec(ctx, `UPDATE device_mailbox_access SET is_active=false, revoked_at=now() WHERE device_id IN (SELECT id FROM devices WHERE user_id=$1) AND is_active=true`, req.TargetUserID)
	if err != nil {
		log.Printf("failed to revoke device access for terminated user %s: %v", req.TargetUserID, err)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"id": req.TargetUserID})
}
