const path = require("path");

function parseBoolean(value, defaultValue = false) {
  if (value === undefined) {
    return defaultValue;
  }

  return value === "true";
}

function parseUsers(rawUsers) {
  return rawUsers
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separatorIndex = entry.indexOf(":");

      if (separatorIndex === -1) {
        throw new Error(`Invalid AUTH_USERS entry: ${entry}`);
      }

      return {
        username: entry.slice(0, separatorIndex),
        password: entry.slice(separatorIndex + 1)
      };
    });
}

function buildIceServers() {
  const servers = [{ urls: "stun:stun.l.google.com:19302" }];

  if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_PASSWORD) {
    servers.push({
      urls: process.env.TURN_URL,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_PASSWORD
    });
  }

  return servers;
}

module.exports = {
  env: process.env.NODE_ENV || "development",
  isProduction: (process.env.NODE_ENV || "development") === "production",
  port: Number(process.env.PORT || 3443),
  jwtSecret: process.env.JWT_SECRET || "dev-only-secret-change-me",
  authUsers: parseUsers(process.env.AUTH_USERS || "alice:password123,bob:password123"),
  trustProxy: parseBoolean(process.env.TRUST_PROXY, false),
  tlsKeyPath: process.env.TLS_KEY_PATH,
  tlsCertPath: process.env.TLS_CERT_PATH,
  publicDir: path.join(__dirname, "..", "public"),
  iceServers: buildIceServers()
};
