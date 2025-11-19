const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const pool = require("../db");
require("dotenv").config();

const router = express.Router();
const SALT_ROUNDS = 10;
const SESSION_TTL_MINUTES = 1440; // 1 day

/* -----------------------------------------
   REGISTER USER
------------------------------------------ */
router.post("/register", async (req, res) => {
  try {
    const { phone, mpin, full_name } = req.body;

    if (!phone || !mpin) {
      return res.status(400).json({
        success: false,
        message: "Phone number and mPIN are required",
      });
    }

    const mpin_hash = await bcrypt.hash(mpin, SALT_ROUNDS);

    const result = await pool.query(
      `INSERT INTO users (phone, full_name, mpin_hash, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (phone) DO UPDATE 
         SET mpin_hash = EXCLUDED.mpin_hash,
             full_name = COALESCE(EXCLUDED.full_name, users.full_name),
             updated_at = NOW()
       RETURNING user_id, phone, full_name;`,
      [phone, full_name || null, mpin_hash]
    );

    res.json({
      success: true,
      message: "User registered successfully",
      user: result.rows[0]
    });


  } catch (err) {
console.error("❌ Register error:", err.message, err.stack);
    res.status(500).json({
      success: false,
      message: "Server error during registration",
    });
  }
});

/* -----------------------------------------
   LOGIN USER
------------------------------------------ */
router.post("/login", async (req, res) => {
  try {
    const { phone, mpin } = req.body;

    if (!phone || !mpin) {
      return res.status(400).json({
        success: false,
        message: "Phone and mPIN required",
      });
    }

    const userRes = await pool.query(
      `SELECT user_id, full_name, phone, mpin_hash 
       FROM users 
       WHERE phone = $1`,
      [phone]
    );

    if (userRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    const user = userRes.rows[0];

    const valid = await bcrypt.compare(mpin, user.mpin_hash);
    if (!valid) {
      return res.status(401).json({
        success: false,
        message: "Invalid mPIN"
      });
    }

    const token = jwt.sign(
      { user_id: user.user_id, phone: user.phone },
      process.env.JWT_SECRET,
      { expiresIn: `${SESSION_TTL_MINUTES}m` }
    );

    await pool.query(
      `INSERT INTO sessions (user_id, token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 day')
       ON CONFLICT (user_id) DO UPDATE 
         SET token = $2, expires_at = NOW() + INTERVAL '1 day'`,
      [user.user_id, token]
    );

    res.json({
      success: true,
      message: "Login successful",
      token,
      user
    });

  } catch (err) {
    console.error("❌ Login error:", err);
    res.status(500).json({
      success: false,
      message: "Server error during login",
    });
  }
});

/* ------------------------------------------------------
   🟩 VALIDATE SESSION TOKEN
------------------------------------------------------- */
router.get("/validate-session", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: "Missing Authorization header",
      });
    }

    const token = authHeader.split(" ")[1];
    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Invalid Authorization header format",
      });
    }

    // Verify JWT
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(403).json({
        success: false,
        message: "Invalid or expired token",
      });
    }

    const user_id = decoded.user_id;

    // Check session table
    const sessionRes = await pool.query(
      `SELECT expires_at 
       FROM sessions 
       WHERE user_id = $1 AND token = $2`,
      [user_id, token]
    );

    if (sessionRes.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Session not found",
      });
    }

    const expiresAt = new Date(sessionRes.rows[0].expires_at);
    const now = new Date();

    if (expiresAt < now) {
      return res.status(403).json({
        success: false,
        message: "Session expired",
      });
    }

    // Get user details
    const userRes = await pool.query(
      `SELECT user_id, full_name, phone 
       FROM users 
       WHERE user_id = $1`,
      [user_id]
    );

    const user = userRes.rows[0];

    return res.json({
      success: true,
      message: "Session valid",
      user: {
        user_id: user.user_id,
        full_name: user.full_name,
        phone: user.phone,
      },
    });

  } catch (err) {
    console.error("❌ Validate-session error:", err);
    res.status(500).json({
      success: false,
      message: "Server error while validating session",
    });
  }
});


module.exports = router;
