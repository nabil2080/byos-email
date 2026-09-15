/**
 * test_control_plane_passkey.cjs
 * Verifies Passkey / Biometrics WebAuthn enrollment and 1-touch login in Control Panel.
 */

const http = require("http");
const crypto = require("crypto");

const API_BASE = "http://127.0.0.1:8080";

function base64UrlEncode(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + path);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        "X-BYOS-Client": "control-plane",
        ...headers,
      },
    };
    if (body) {
      const data = typeof body === "string" ? body : JSON.stringify(body);
      options.headers["Content-Type"] = options.headers["Content-Type"] || "application/json";
      options.headers["Content-Length"] = Buffer.byteLength(data);
    }
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        const text = buf.toString("utf8");
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          setCookie: res.headers["set-cookie"] || [],
          raw: buf,
          text,
          json,
        });
      });
    });
    req.on("error", reject);
    if (body) {
      const data = typeof body === "string" ? body : JSON.stringify(body);
      req.write(data);
    }
    req.end();
  });
}

async function run() {
  console.log("=== Control Panel Passkey & 1-Touch Biometrics Test ===\n");
  let failures = 0;

  function assert(cond, msg) {
    if (cond) {
      console.log(`  ✓ PASS: ${msg}`);
    } else {
      console.error(`  ✗ FAIL: ${msg}`);
      failures++;
    }
  }

  // 1. Login as Admin with X-BYOS-Client: control-plane
  console.log("[1] Authenticating Control Panel Admin...");
  const loginRes = await request("POST", "/v1/auth/login", {
    email: "admin@testorg.byos",
    password: "BYOSTest2026!",
  });
  assert(loginRes.status === 200, `Admin login succeeded (status ${loginRes.status})`);
  const cpCookies = loginRes.setCookie.map((c) => c.split(";")[0]).join("; ");
  const cpToken = loginRes.json?.token;
  const adminEmail = loginRes.json?.email;
  assert(cpCookies.includes("byos_cp_session="), "Cookie byos_cp_session was set for Control Panel");
  assert(!cpCookies.includes("byos_webmail_session="), "Cookie byos_webmail_session was NOT set");

  // 2. Fetch passkey register options
  console.log("\n[2] Fetching WebAuthn Passkey Registration Options...");
  const regOptsRes = await request("GET", "/v1/auth/passkeys/register-options", null, {
    Cookie: cpCookies,
    Authorization: `Bearer ${cpToken}`,
  });
  assert(regOptsRes.status === 200, "Passkey register options returned 200 OK");
  const regOpts = regOptsRes.json;
  assert(!!regOpts?.challenge, "Challenge received");
  assert(
    regOpts?.rp && (regOpts.rp.id === "localhost" || regOpts.rp.id === "127.0.0.1"),
    `RP ID is valid (${regOpts?.rp?.id})`
  );

  // 3. Register a test passkey (e.g. MacBook Touch ID / Windows Hello)
  console.log("\n[3] Enrolling Control Panel Admin Passkey...");
  const fakeCredRawId = crypto.randomBytes(32);
  const fakeCredId = base64UrlEncode(fakeCredRawId);
  const fakePubKeyHex =
    "a5010203262001215820" + crypto.randomBytes(32).toString("hex") + "225820" + crypto.randomBytes(32).toString("hex");

  const registerRes = await request(
    "POST",
    "/v1/auth/passkeys/register",
    {
      credential_id: fakeCredId,
      public_key: fakePubKeyHex,
      device_name: "YubiKey 5C NFC / Touch ID",
      challenge_token: regOpts.challenge,
    },
    {
      Cookie: cpCookies,
      Authorization: `Bearer ${cpToken}`,
    }
  );
  assert(
    registerRes.status === 200 || registerRes.status === 201,
    `Passkey registered successfully (status ${registerRes.status})`
  );
  const passkeyId = registerRes.json?.id;
  assert(!!passkeyId, `Passkey ID returned: ${passkeyId}`);

  // 4. List passkeys in Control Panel
  console.log("\n[4] Listing Registered Passkeys in Control Panel...");
  const listRes = await request("GET", "/v1/auth/passkeys", null, {
    Cookie: cpCookies,
    Authorization: `Bearer ${cpToken}`,
  });
  assert(listRes.status === 200, "Passkeys listed successfully");
  const passkeyList = listRes.json || [];
  const found = passkeyList.find((p) => p.id === passkeyId);
  assert(!!found, "Newly enrolled passkey found in passkeys list");
  assert(found && found.device_name === "YubiKey 5C NFC / Touch ID", "Device name matches correctly");

  // 5. 1-Touch Passkey Login Options (discoverable, without email)
  console.log("\n[5] Requesting 1-Touch Passkey Login Options (Discoverable Credential)...");
  const loginOptsRes = await request("GET", "/v1/auth/passkeys/login-options");
  assert(loginOptsRes.status === 200, "Login options returned 200 OK");
  const loginOpts = loginOptsRes.json;
  assert(!!loginOpts?.challenge, "Login challenge received");

  // 6. Simulate 1-Touch Passkey Assertion Login to Control Panel
  console.log("\n[6] Performing 1-Touch Biometric Sign-in to Control Panel...");
  const clientData = Buffer.from(
    JSON.stringify({
      type: "webauthn.get",
      challenge: loginOpts.challenge,
      origin: "http://localhost:3000",
    })
  );
  const clientDataB64 = base64UrlEncode(clientData);

  const passkeyLoginRes = await request("POST", "/v1/auth/passkeys/login", {
    credential_id: fakeCredId,
    challenge_token: loginOpts.challenge,
    signature: "00".repeat(64),
    client_data_json: clientDataB64,
  });
  assert(passkeyLoginRes.status === 200, `Passkey login succeeded (status ${passkeyLoginRes.status})`);
  const passkeyLoginCookies = passkeyLoginRes.setCookie.map((c) => c.split(";")[0]).join("; ");
  const passkeyLoginData = passkeyLoginRes.json;

  assert(
    passkeyLoginCookies.includes("byos_cp_session="),
    "Passkey login set byos_cp_session cookie for Control Panel"
  );
  assert(
    !passkeyLoginCookies.includes("byos_webmail_session="),
    "Passkey login did NOT leak byos_webmail_session cookie"
  );
  assert(!!passkeyLoginData?.token, "Passkey login issued session token for localStorage");
  assert(
    passkeyLoginData?.role === "owner" || passkeyLoginData?.role === "admin",
    `User role is administrative (${passkeyLoginData?.role})`
  );

  // 7. Test /v1/auth/me with Passkey Session
  console.log("\n[7] Verifying Control Panel Session with /v1/auth/me...");
  const meRes = await request("GET", "/v1/auth/me", null, {
    Cookie: passkeyLoginCookies,
    Authorization: `Bearer ${passkeyLoginData.token}`,
  });
  assert(meRes.status === 200, `/v1/auth/me authenticated with passkey session`);
  assert(meRes.json?.email === adminEmail, `Authenticated user matches (${meRes.json?.email})`);

  // 8. Revoke the test passkey
  console.log("\n[8] Revoking Test Passkey...");
  const delRes = await request("DELETE", `/v1/auth/passkeys/${passkeyId}`, null, {
    Cookie: passkeyLoginCookies,
    Authorization: `Bearer ${passkeyLoginData.token}`,
  });
  assert(delRes.status === 204 || delRes.status === 200, "Passkey revoked successfully (204 No Content)");

  console.log("\n=== Test Summary ===");
  if (failures === 0) {
    console.log("All Control Panel passkey tests PASSED! (0 failures)");
  } else {
    console.error(`FAILED with ${failures} errors.`);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
