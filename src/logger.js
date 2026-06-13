function log(level, message, metadata = {}) {
  const event = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...metadata
  };

  console.log(JSON.stringify(event));
}

module.exports = {
  info(message, metadata) {
    log("info", message, metadata);
  },
  error(message, metadata) {
    log("error", message, metadata);
  }
};
