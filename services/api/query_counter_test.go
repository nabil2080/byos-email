package main

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"reflect"
	"sync"
	"sync/atomic"
	"testing"
	"unsafe"
)

// QueryCounter defines the interface for tracking database queries executed in tests.
type QueryCounter interface {
	Count() int
	Reset()
}

type queryCounter struct {
	count atomic.Int64
	mu    sync.Mutex
	stmts []string
}

func (q *queryCounter) Count() int {
	return int(q.count.Load())
}

func (q *queryCounter) Reset() {
	q.count.Store(0)
	q.mu.Lock()
	q.stmts = nil
	q.mu.Unlock()
}

func (q *queryCounter) record(query string) {
	q.count.Add(1)
	q.mu.Lock()
	q.stmts = append(q.stmts, query)
	q.mu.Unlock()
}

func (q *queryCounter) Statements() []string {
	q.mu.Lock()
	defer q.mu.Unlock()
	copied := make([]string, len(q.stmts))
	copy(copied, q.stmts)
	return copied
}

type countingConnector struct {
	target  driver.Connector
	counter *queryCounter
}

func (c *countingConnector) Connect(ctx context.Context) (driver.Conn, error) {
	conn, err := c.target.Connect(ctx)
	if err != nil {
		return nil, err
	}
	return &countingConn{target: conn, counter: c.counter}, nil
}

func (c *countingConnector) Driver() driver.Driver {
	return c.target.Driver()
}

type countingConn struct {
	target  driver.Conn
	counter *queryCounter
}

func (c *countingConn) Prepare(query string) (driver.Stmt, error) {
	c.counter.record(query)
	stmt, err := c.target.Prepare(query)
	if err != nil {
		return nil, err
	}
	return &countingStmt{target: stmt, query: query, counter: c.counter}, nil
}

func (c *countingConn) PrepareContext(ctx context.Context, query string) (driver.Stmt, error) {
	c.counter.record(query)
	if prepCtx, ok := c.target.(driver.ConnPrepareContext); ok {
		stmt, err := prepCtx.PrepareContext(ctx, query)
		if err != nil {
			return nil, err
		}
		return &countingStmt{target: stmt, query: query, counter: c.counter}, nil
	}
	stmt, err := c.target.Prepare(query)
	if err != nil {
		return nil, err
	}
	return &countingStmt{target: stmt, query: query, counter: c.counter}, nil
}

func (c *countingConn) Close() error {
	return c.target.Close()
}

func (c *countingConn) Begin() (driver.Tx, error) {
	c.counter.record("BEGIN")
	return c.target.Begin()
}

func (c *countingConn) BeginTx(ctx context.Context, opts driver.TxOptions) (driver.Tx, error) {
	c.counter.record("BEGIN")
	if connBegin, ok := c.target.(driver.ConnBeginTx); ok {
		return connBegin.BeginTx(ctx, opts)
	}
	return c.target.Begin()
}

func (c *countingConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	c.counter.record(query)
	if execer, ok := c.target.(driver.ExecerContext); ok {
		return execer.ExecContext(ctx, query, args)
	}
	if execer, ok := c.target.(driver.Execer); ok {
		dargs := make([]driver.Value, len(args))
		for i, arg := range args {
			dargs[i] = arg.Value
		}
		return execer.Exec(query, dargs)
	}
	return nil, driver.ErrSkip
}

func (c *countingConn) Exec(query string, args []driver.Value) (driver.Result, error) {
	c.counter.record(query)
	if execer, ok := c.target.(driver.Execer); ok {
		return execer.Exec(query, args)
	}
	return nil, driver.ErrSkip
}

func (c *countingConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	c.counter.record(query)
	if queryer, ok := c.target.(driver.QueryerContext); ok {
		return queryer.QueryContext(ctx, query, args)
	}
	if queryer, ok := c.target.(driver.Queryer); ok {
		dargs := make([]driver.Value, len(args))
		for i, arg := range args {
			dargs[i] = arg.Value
		}
		return queryer.Query(query, dargs)
	}
	return nil, driver.ErrSkip
}

func (c *countingConn) Query(query string, args []driver.Value) (driver.Rows, error) {
	c.counter.record(query)
	if queryer, ok := c.target.(driver.Queryer); ok {
		return queryer.Query(query, args)
	}
	return nil, driver.ErrSkip
}

func (c *countingConn) Ping(ctx context.Context) error {
	if pinger, ok := c.target.(driver.Pinger); ok {
		return pinger.Ping(ctx)
	}
	return nil
}

func (c *countingConn) ResetSession(ctx context.Context) error {
	if resetter, ok := c.target.(driver.SessionResetter); ok {
		return resetter.ResetSession(ctx)
	}
	return nil
}

func (c *countingConn) IsValid() bool {
	if validator, ok := c.target.(driver.Validator); ok {
		return validator.IsValid()
	}
	return true
}

func (c *countingConn) CheckNamedValue(nv *driver.NamedValue) error {
	if nvc, ok := c.target.(driver.NamedValueChecker); ok {
		return nvc.CheckNamedValue(nv)
	}
	return nil
}

type countingStmt struct {
	target  driver.Stmt
	query   string
	counter *queryCounter
}

func (s *countingStmt) Close() error {
	return s.target.Close()
}

func (s *countingStmt) NumInput() int {
	return s.target.NumInput()
}

func (s *countingStmt) Exec(args []driver.Value) (driver.Result, error) {
	s.counter.record(s.query)
	return s.target.Exec(args)
}

func (s *countingStmt) Query(args []driver.Value) (driver.Rows, error) {
	s.counter.record(s.query)
	return s.target.Query(args)
}

func (s *countingStmt) ExecContext(ctx context.Context, args []driver.NamedValue) (driver.Result, error) {
	s.counter.record(s.query)
	if stmtExec, ok := s.target.(driver.StmtExecContext); ok {
		return stmtExec.ExecContext(ctx, args)
	}
	dargs := make([]driver.Value, len(args))
	for i, arg := range args {
		dargs[i] = arg.Value
	}
	return s.target.Exec(dargs)
}

func (s *countingStmt) QueryContext(ctx context.Context, args []driver.NamedValue) (driver.Rows, error) {
	s.counter.record(s.query)
	if stmtQuery, ok := s.target.(driver.StmtQueryContext); ok {
		return stmtQuery.QueryContext(ctx, args)
	}
	dargs := make([]driver.Value, len(args))
	for i, arg := range args {
		dargs[i] = arg.Value
	}
	return s.target.Query(dargs)
}

func (s *countingStmt) CheckNamedValue(nv *driver.NamedValue) error {
	if nvc, ok := s.target.(driver.NamedValueChecker); ok {
		return nvc.CheckNamedValue(nv)
	}
	return nil
}

// StartQueryCounter installs a SQL statement counting wrapper onto db.
// It returns a QueryCounter interface that records each statement executed
// and can be reset or inspected during a test block.
func StartQueryCounter(t *testing.T, db *sql.DB) QueryCounter {
	t.Helper()

	qc := &queryCounter{}

	dbVal := reflect.ValueOf(db).Elem()
	connectorField := dbVal.FieldByName("connector")
	if !connectorField.IsValid() {
		t.Fatalf("StartQueryCounter: unable to find connector field on *sql.DB")
	}

	origConnector := reflect.NewAt(connectorField.Type(), unsafe.Pointer(connectorField.UnsafeAddr())).Elem().Interface().(driver.Connector)

	wrapped := &countingConnector{
		target:  origConnector,
		counter: qc,
	}

	reflect.NewAt(connectorField.Type(), unsafe.Pointer(connectorField.UnsafeAddr())).Elem().Set(reflect.ValueOf(wrapped))

	// Close existing idle connections to ensure all subsequent queries go through counting connector
	db.SetMaxIdleConns(0)

	t.Cleanup(func() {
		// Restore original connector on test completion
		reflect.NewAt(connectorField.Type(), unsafe.Pointer(connectorField.UnsafeAddr())).Elem().Set(reflect.ValueOf(origConnector))
		db.SetMaxIdleConns(2)
	})

	return qc
}

func TestQueryCounter(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	counter := StartQueryCounter(t, db)

	// Execute 3 queries
	var one, two, three int
	if err := db.QueryRow("SELECT 1").Scan(&one); err != nil {
		t.Fatalf("failed query 1: %v", err)
	}
	if err := db.QueryRow("SELECT 2").Scan(&two); err != nil {
		t.Fatalf("failed query 2: %v", err)
	}
	if err := db.QueryRow("SELECT 3").Scan(&three); err != nil {
		t.Fatalf("failed query 3: %v", err)
	}

	if counter.Count() != 3 {
		t.Fatalf("expected count 3, got %d", counter.Count())
	}

	counter.Reset()
	if counter.Count() != 0 {
		t.Fatalf("expected count 0 after reset, got %d", counter.Count())
	}

	if err := db.QueryRow("SELECT 4").Scan(&one); err != nil {
		t.Fatalf("failed query after reset: %v", err)
	}
	if counter.Count() != 1 {
		t.Fatalf("expected count 1, got %d", counter.Count())
	}
}
