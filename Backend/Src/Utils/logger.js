// Backend/Src/Utils/logger.js
//
// AETHARIA — Logger
// ================================
// Simple timestamped logger. Keeping this as a thin wrapper
// for now so we can swap in a proper logging library (winston,
// pino, etc.) later without changing every file.
//
// All log output goes to stdout, which is correct for containers
// (Docker/K8s capture stdout for log aggregation).

/**
 * Log a message with an ISO timestamp.
 *
 * @param {string} msg - Message to log
 * @param {string} [level='INFO'] - Log level (INFO, WARN, ERROR, DEBUG)
 */
function log(msg, level = 'INFO') {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level}] ${msg}`);
}

// Convenience methods
log.info = (msg) => log(msg, 'INFO');
log.warn = (msg) => log(msg, 'WARN');
log.error = (msg) => log(msg, 'ERROR');
log.debug = (msg) => {
  if (process.env.AETHARIA_DEBUG === 'true') {
    log(msg, 'DEBUG');
  }
};

module.exports = log;
