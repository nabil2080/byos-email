#!/usr/bin/env node
/**
 * BYOS Manual OTP Live Delivery Verification Script
 * 
 * Objective: Send one real Email OTP to abdullahrawha30@gmail.com
 *            and one real SMS OTP to +8801617856836.
 * 
 * CAUTION: Per task instructions, DO NOT run this script until you have supplied
 * provider credentials in your local environment and explicitly approved the sends.
 */

import readline from 'node:readline';

const API_BASE = process.env.API_BASE || 'http://localhost:8080';
const TARGET_EMAIL = 'abdullahrawha30@gmail.com';
const TARGET_PHONE = '+8801617856836';

function prompt(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => rl.question(query, (ans) => {
    rl.close();
    resolve(ans);
  }));
}

async function requestJSON(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, ok: res.ok, json, text };
}

async function main() {
  console.log("================================================================================");
  console.log("            BYOS MANUAL LIVE OTP DELIVERY VERIFICATION SUITE                    ");
  console.log("================================================================================\n");

  console.log("Target Email: " + TARGET_EMAIL);
  console.log("Target Phone: " + TARGET_PHONE);
  console.log("API Endpoint: " + API_BASE + "\n");

  const confirm = await prompt("Are you ready to send REAL messages to these destinations? (type 'yes' to proceed): ");
  if (confirm.trim().toLowerCase() !== 'yes') {
    console.log("Aborted by user.");
    process.exit(0);
  }

  // 1. Authenticate as Alice to test Recovery Contact OTP dispatch
  console.log("\n[STEP 1] Logging in as Alice to obtain administrative session...");
  const loginRes = await requestJSON('/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'alice@byos.local', password: 'test-password-123' }),
  });

  if (!loginRes.ok) {
    console.error("Login failed:", loginRes.text);
    process.exit(1);
  }

  const token = loginRes.json.token;
  console.log("Session established successfully.");

  // 2. Dispatch Real Email OTP
  console.log(`\n[STEP 2] Dispatching real Email OTP to ${TARGET_EMAIL}...`);
  const emailRes = await requestJSON('/v1/auth/recovery-contacts/send-code', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ type: 'email', destination: TARGET_EMAIL }),
  });

  if (!emailRes.ok) {
    console.error("Failed to send Email OTP:", emailRes.text);
    process.exit(1);
  }

  const emailChallengeToken = emailRes.json.challenge_token;
  console.log("Email OTP dispatched successfully!");
  console.log("Masked destination:", emailRes.json.destination_masked);

  const emailCode = await prompt("\nEnter the 6-digit code received in abdullahrawha30@gmail.com: ");
  const verifyEmailRes = await requestJSON('/v1/auth/recovery-contacts/confirm', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ type: 'email', challenge_token: emailChallengeToken, code: emailCode.trim() }),
  });

  if (!verifyEmailRes.ok) {
    console.error("Email OTP verification failed:", verifyEmailRes.text);
    process.exit(1);
  }
  console.log("PASS: Real Email OTP verified successfully!");

  // 3. Dispatch Real SMS OTP
  console.log(`\n[STEP 3] Dispatching real SMS OTP to ${TARGET_PHONE}...`);
  const smsRes = await requestJSON('/v1/auth/recovery-contacts/send-code', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ type: 'phone', destination: TARGET_PHONE }),
  });

  if (!smsRes.ok) {
    console.error("Failed to send SMS OTP:", smsRes.text);
    process.exit(1);
  }

  const smsChallengeToken = smsRes.json.challenge_token;
  console.log("SMS OTP dispatched successfully!");
  console.log("Masked destination:", smsRes.json.destination_masked);

  const smsCode = await prompt("\nEnter the 6-digit code received on +8801617856836: ");
  const verifySmsRes = await requestJSON('/v1/auth/recovery-contacts/confirm', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ type: 'phone', challenge_token: smsChallengeToken, code: smsCode.trim() }),
  });

  if (!verifySmsRes.ok) {
    console.error("SMS OTP verification failed:", verifySmsRes.text);
    process.exit(1);
  }
  console.log("PASS: Real SMS OTP verified successfully!");

  console.log("\n================================================================================");
  console.log("          ALL REAL OTP DELIVERIES AND VERIFICATIONS SUCCEEDED!                  ");
  console.log("================================================================================\n");
}

main().catch(console.error);
