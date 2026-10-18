package main

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Valid tour IDs supported by the platform
var validTourIDs = map[string]bool{
	"control_plane_v1": true,
}

// TourRecord models persistent progress for a single tour
type TourRecord struct {
	CompletedAt *time.Time `json:"completed_at"`
	SkippedAt   *time.Time `json:"skipped_at"`
	LastStep    int        `json:"last_step"`
}

// TourStateResponse models the response for GET /v1/tours/state
type TourStateResponse struct {
	Tours map[string]TourRecord `json:"tours"`
}

// TourUpdateRequest models the optional payload for complete/skip
type TourUpdateRequest struct {
	LastStep int `json:"last_step,omitempty"`
}

func getTourIDFromRequest(r *http.Request) string {
	tourID := r.PathValue("tour_id")
	if tourID != "" {
		return tourID
	}
	// Fallback path parser: /v1/tours/{tour_id}/(complete|skip|reset)
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	for i, part := range parts {
		if part == "tours" && i+1 < len(parts) {
			return parts[i+1]
		}
	}
	return ""
}

// tourStateHandler handles GET /v1/tours/state
func tourStateHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}

	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	var rawJSON []byte
	err = conn.QueryRow(ctx, `SELECT COALESCE(tours_seen, '{}'::jsonb) FROM users WHERE id = $1`, userID).Scan(&rawJSON)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}

	tours := make(map[string]TourRecord)
	if len(rawJSON) > 0 {
		_ = json.Unmarshal(rawJSON, &tours)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(TourStateResponse{
		Tours: tours,
	})
}

// tourCompleteHandler handles POST /v1/tours/{tour_id}/complete
func tourCompleteHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	tourID := getTourIDFromRequest(r)
	if !validTourIDs[tourID] {
		http.Error(w, "invalid tour_id", http.StatusBadRequest)
		return
	}

	var req TourUpdateRequest
	_ = json.NewDecoder(r.Body).Decode(&req)
	lastStep := req.LastStep
	if lastStep <= 0 {
		if tourID == "control_plane_v1" {
			lastStep = 7
		} else {
			lastStep = 6
		}
	}

	now := time.Now().UTC()
	record := TourRecord{
		CompletedAt: &now,
		SkippedAt:   nil,
		LastStep:    lastStep,
	}

	recordBytes, err := json.Marshal(record)
	if err != nil {
		http.Error(w, "failed to marshal tour record", http.StatusInternalServerError)
		return
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}

	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	_, err = conn.Exec(ctx, `
		UPDATE users
		SET tours_seen = jsonb_set(COALESCE(tours_seen, '{}'::jsonb), ARRAY[$1], $2::jsonb, true)
		WHERE id = $3
	`, tourID, string(recordBytes), userID)
	if err != nil {
		http.Error(w, "failed to update tour record", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "ok",
		"tour_id": tourID,
		"record":  record,
	})
}

// tourSkipHandler handles POST /v1/tours/{tour_id}/skip
func tourSkipHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	tourID := getTourIDFromRequest(r)
	if !validTourIDs[tourID] {
		http.Error(w, "invalid tour_id", http.StatusBadRequest)
		return
	}

	var req TourUpdateRequest
	_ = json.NewDecoder(r.Body).Decode(&req)
	lastStep := req.LastStep

	now := time.Now().UTC()
	record := TourRecord{
		CompletedAt: nil,
		SkippedAt:   &now,
		LastStep:    lastStep,
	}

	recordBytes, err := json.Marshal(record)
	if err != nil {
		http.Error(w, "failed to marshal tour record", http.StatusInternalServerError)
		return
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}

	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	_, err = conn.Exec(ctx, `
		UPDATE users
		SET tours_seen = jsonb_set(COALESCE(tours_seen, '{}'::jsonb), ARRAY[$1], $2::jsonb, true)
		WHERE id = $3
	`, tourID, string(recordBytes), userID)
	if err != nil {
		http.Error(w, "failed to update tour record", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "ok",
		"tour_id": tourID,
		"record":  record,
	})
}

// tourResetHandler handles POST /v1/tours/{tour_id}/reset
func tourResetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	tourID := getTourIDFromRequest(r)
	if !validTourIDs[tourID] {
		http.Error(w, "invalid tour_id", http.StatusBadRequest)
		return
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}

	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	_, err = conn.Exec(ctx, `
		UPDATE users
		SET tours_seen = COALESCE(tours_seen, '{}'::jsonb) - $1
		WHERE id = $2
	`, tourID, userID)
	if err != nil {
		http.Error(w, "failed to reset tour record", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "ok",
		"tour_id": tourID,
		"reset":   true,
	})
}
