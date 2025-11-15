// backend/src/utils/logger.js

module.exports = function log(msg) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${msg}`);
};
