const admin = require("firebase-admin");
const path = require("path");
require("dotenv").config();

// load service account JSON file (preferred)
// adjust path if needed
const serviceAccount = require(path.join(__dirname, "..", "firebase-service-account.json"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

module.exports = admin;
