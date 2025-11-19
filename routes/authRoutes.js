const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const pool = require("../db");
require("dotenv").config();

const router = express.Router();
const SALT_ROUNDS = 10;
const SESSION_TTL_MINUTES = parseInt(process.env.SESSION_TTL_MINUTES || "1440", 10); // default 1 day

/* -----------------------------------------
   🔐 REGISTER USER WITH MPIN
------------------------------------------ */
router.post("/register", async (req, res) => {
  try {
    const { phone_number, mpin, username } = req.body;

    if (!phone_number || !mpin) {
      return res.status(400).json({
        success: false,
        message: "Phone number and mPIN are required",
      });
    }

    // hash mPIN
    const mpin_hash = await bcrypt.hash(mpin, SALT_ROUNDS);

    // create or update user
    const result = await pool.query(
      `INSERT INTO users (phone_number, mpin_hash, username, is_verified, created_at, updated_at)
       VALUES ($1, $2, $3, TRUE, NOW(), NOW())
       ON CONFLICT (phone_number) DO UPDATE 
       SET mpin_hash = EXCLUDED.mpin_hash,
           username = COALESCE(EXCLUDED.username, users.username),
           updated_at = NOW()
       RETURNING id, phone_number, username;`,
      [phone_number, mpin_hash, username || null]
    );

    res.json({
      success: true,
      message: "User registered successfully",
      user: result.rows[0],
    });
  } catch (err) {
    console.error("❌ Register error:", err);
    res.status(500).json({
      success: false,
      message: "Server error while registering",
    });
  }
});

/* -----------------------------------------
   🔐 LOGIN WITH PHONE + MPIN
------------------------------------------ */
router.post("/login", async (req, res) => {
  try {
    const { phone_number, mpin } = req.body;

    if (!phone_number || !mpin) {
      return res.status(400).json({
        success: false,
        message: "Phone number and mPIN are required",
      });
    }

    // check user exists
    const userResult = await pool.query(
      "SELECT id, phone_number, mpin_hash, username FROM users WHERE phone_number = $1",
      [phone_number]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const user = userResult.rows[0];

    // verify mpin
    const isMatch = await bcrypt.compare(mpin, user.mpin_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid mPIN" });
    }

    // generate JWT session
    const expiresAt = new Date(Date.now() + SESSION_TTL_MINUTES * 60 * 1000);

    const token = jwt.sign(
      { user_id: user.id, phone_number: user.phone_number },
      process.env.JWT_SECRET,
      { expiresIn: `${SESSION_TTL_MINUTES}m` }
    );

    // store session
    await pool.query(
      `INSERT INTO sessions (user_id, token, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET token = $2, expires_at = $3`,
      [user.id, token, expiresAt]
    );

    res.json({
      success: true,
      message: "Login successful",
      user_id: user.id,
      username: user.username,
      token,
    });
  } catch (err) {
    console.error("❌ Login error:", err);
    res.status(500).json({
      success: false,
      message: "Server error during login",
    });
  }
});

/* -----------------------------------------
   🟩 VALIDATE SESSION TOKEN
------------------------------------------ */
router.get("/validate-session", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader)
    return res.status(401).json({ success: false, message: "Missing token" });

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // check session in db
    const result = await pool.query(
      "SELECT expires_at FROM sessions WHERE user_id = $1 AND token = $2",
      [decoded.user_id, token]
    );

    if (result.rows.length === 0)
      return res.status(401).json({ success: false, message: "Invalid session" });

    const expiresAt = new Date(result.rows[0].expires_at);
    if (expiresAt < new Date())
      return res.status(403).json({ success: false, message: "Session expired" });

    res.json({
      success: true,
      message: "Session valid",
      user_id: decoded.user_id,
      phone_number: decoded.phone_number,
    });
  } catch (err) {
    console.error("❌ Validate session error:", err);
    res.status(403).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
});

module.exports = router;
