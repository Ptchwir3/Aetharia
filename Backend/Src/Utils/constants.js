// Backend/Src/Utils/constants.js
//
// Re-exports shared constants from the Shared/ directory.
// This file exists so backend code can do:
//   const { WORLD } = require('./Utils/constants');
//
// Supports two layouts:
//   Local dev:  Backend/Src/Utils/ → ../../../Shared/Utils/constants
//   Docker:     /app/Src/Utils/    → /app/Shared/Utils/constants

const path = require('path');
const fs = require('fs');

// Try Docker path first (/app/Shared), then local dev path
const dockerPath = path.resolve(__dirname, '../../Shared/Utils/constants');
const localPath = path.resolve(__dirname, '../../../Shared/Utils/constants');

if (fs.existsSync(dockerPath + '.js')) {
  module.exports = require(dockerPath);
} else {
  module.exports = require(localPath);
}
