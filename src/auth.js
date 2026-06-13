const jwt = require("jsonwebtoken");
const config = require("./config");

const userMap = new Map(config.authUsers.map((user) => [user.username, user.password]));

function issueToken(username) {
  return jwt.sign({ sub: username }, config.jwtSecret, {
    expiresIn: "2h",
    issuer: "secure-video-call-app",
    audience: "secure-video-call-users"
  });
}

function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret, {
    issuer: "secure-video-call-app",
    audience: "secure-video-call-users"
  });
}

function authenticateCredentials(username, password) {
  return userMap.get(username) === password;
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const [, token] = header.split(" ");

  if (!token) {
    return res.status(401).json({ error: "Authentication required." });
  }

  try {
    const payload = verifyToken(token);
    req.user = { username: payload.sub };
    return next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired token." });
  }
}

module.exports = {
  authenticateCredentials,
  issueToken,
  verifyToken,
  authMiddleware
};
