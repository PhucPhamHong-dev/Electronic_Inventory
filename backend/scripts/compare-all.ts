import "dotenv/config";
import { spawnSync } from "node:child_process";

const legacyBaseUrl = process.env.LEGACY_BASE_URL ?? "http://localhost:3000";
const nestBaseUrl = process.env.NEST_BASE_URL ?? "http://localhost:3001";

function getCompareCredentials() {
  return {
    username:
      process.env.COMPARE_USERNAME ??
      process.env.AUTH_COMPARE_USERNAME ??
      process.env.E2E_USERNAME,
    password:
      process.env.COMPARE_PASSWORD ??
      process.env.AUTH_COMPARE_PASSWORD ??
      process.env.E2E_PASSWORD
  };
}

async function loginForToken() {
  const credentials = getCompareCredentials();
  if (!credentials.username || !credentials.password) {
    throw new Error(
      "Missing compare credentials. Set AUTH_TOKEN or COMPARE_USERNAME and COMPARE_PASSWORD in backend/.env"
    );
  }

  const response = await fetch(`${legacyBaseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      username: credentials.username,
      password: credentials.password
    })
  });

  const payload = await response.json().catch(() => null);
  const accessToken = payload?.data?.accessToken;

  if (!response.ok || !accessToken) {
    throw new Error(`Unable to get compare token from ${legacyBaseUrl}/api/v1/auth/login`);
  }

  return accessToken as string;
}

async function main() {
  const authToken = process.env.AUTH_TOKEN ?? (await loginForToken());

  console.log(
    JSON.stringify({
      legacyBaseUrl,
      nestBaseUrl,
      authTokenSource: process.env.AUTH_TOKEN ? "env" : "login"
    })
  );

  const child = spawnSync("npx", ["tsx", "scripts/compare-phase2-7.ts"], {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      LEGACY_BASE_URL: legacyBaseUrl,
      NEST_BASE_URL: nestBaseUrl,
      AUTH_TOKEN: authToken
    }
  });

  if (typeof child.status === "number") {
    process.exitCode = child.status;
    return;
  }

  if (child.error) {
    throw child.error;
  }
}

void main();
