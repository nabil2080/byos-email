-- Verification script for user tour state persistence
SELECT id, email, tours_seen 
FROM users 
WHERE email = 'alice@byos.local';
