// routes/chantingRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db");
const jwt = require("jsonwebtoken");

/**
 * Simple auth middleware that verifies JWT and attaches user_id to req.
 * Expects JWT signed with payload containing `user_id`.
 */
const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader)
    return res.status(401).json({ success: false, message: "Missing token" });

  const token = authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ success: false, message: "Missing token" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Attach user_id to request for routes to use
    if (!decoded || !decoded.user_id) {
      return res.status(401).json({ success: false, message: "Invalid token payload" });
    }

    req.user_id = decoded.user_id;
    next();
  } catch (err) {
    console.error("Auth middleware error:", err);
    return res.status(403).json({ success: false, message: "Invalid or expired token" });
  }
};

/* --------------------------------------------------------------------------
  POST /chanting/add
  Body: { rounds: int, chant_date?: ISO string or date (optional) }
  Auth: required (Bearer token)
-------------------------------------------------------------------------- */
router.post("/add", authMiddleware, async (req, res) => {
  try {
    const { rounds, chant_date } = req.body;
    const user_id = req.user_id; // provided by middleware

    if (!rounds || typeof rounds !== "number" || rounds <= 0) {
      return res.status(400).json({
        success: false,
        message: "Rounds required and must be a positive number",
      });
    }

    // Use provided chant_date (if valid) or fallback to now
    const chantDate = chant_date ? new Date(chant_date) : new Date();

    // Insert chanting record. created_at column accepts timestamp.
    const entryRes = await pool.query(
      `INSERT INTO chant_entries (user_id, rounds, created_at)
       VALUES ($1, $2, $3)
       RETURNING entry_id, rounds, created_at;`,
      [user_id, rounds, chantDate]
    );

    // Normalize today string for streak comparisons / storage (YYYY-MM-DD)
    const todayStr = chantDate.toISOString().split("T")[0];

    // Fetch existing streak row for user (if any)
    const streakRow = await pool.query(
      `SELECT current_streak, longest_streak, last_date
       FROM user_streaks
       WHERE user_id = $1`,
      [user_id]
    );

    let currentStreak = 1;
    let longestStreak = 1;

    if (streakRow.rows.length > 0) {
      const row = streakRow.rows[0];
      // last_date may be stored as a Date, timestamp, or string. Normalize to YYYY-MM-DD
      let prevDateStr = null;
      if (row.last_date) {
        if (row.last_date instanceof Date) {
          prevDateStr = row.last_date.toISOString().split("T")[0];
        } else {
          // try to parse string
          try {
            prevDateStr = new Date(row.last_date).toISOString().split("T")[0];
          } catch (e) {
            prevDateStr = null;
          }
        }
      }

      // Compute yesterday relative to the inserted chantDate
      const yesterday = new Date(chantDate);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split("T")[0];

      if (prevDateStr === yesterdayStr) {
        currentStreak = (row.current_streak || 0) + 1;
      } else if (prevDateStr === todayStr) {
        // if the last_date is already today, keep current streak (avoid double counting)
        currentStreak = row.current_streak || 1;
      } else {
        currentStreak = 1;
      }

      longestStreak = Math.max(row.longest_streak || 0, currentStreak);

      // Update streak record: set last_date to today's date string (or timestamp)
      await pool.query(
        `UPDATE user_streaks
         SET current_streak = $1,
             longest_streak = $2,
             last_date = $3,
             created_at = COALESCE(created_at, NOW())
         WHERE user_id = $4`,
        [currentStreak, longestStreak, todayStr, user_id]
      );
    } else {
      // Create streak row for first-time user
      await pool.query(
        `INSERT INTO user_streaks (user_id, current_streak, longest_streak, last_date, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [user_id, 1, 1, todayStr]
      );
      currentStreak = 1;
      longestStreak = 1;
    }

    return res.json({
      success: true,
      message: "Chant entry added",
      entry: entryRes.rows[0],
      streaks: { currentStreak, longestStreak },
    });
  } catch (err) {
    console.error("❌ Error in /add:", err);
    return res.status(500).json({
      success: false,
      message: "Server error adding chant",
      detail: err.message,
    });
  }
});

/* --------------------------------------------------------------------------
  GET /chanting/summary
  Auth: required (Bearer token)
  Returns total rounds, daily aggregated rounds and streaks
-------------------------------------------------------------------------- */
router.get("/summary", authMiddleware, async (req, res) => {
  try {
    const user_id = req.user_id;

    const totalRes = await pool.query(
      `SELECT COALESCE(SUM(rounds), 0) AS total_rounds
       FROM chant_entries WHERE user_id = $1`,
      [user_id]
    );

    const dailyRes = await pool.query(
      `SELECT DATE(created_at) AS date, SUM(rounds) AS rounds
       FROM chant_entries
       WHERE user_id = $1
       GROUP BY DATE(created_at)
       ORDER BY date DESC`,
      [user_id]
    );

    const streakRes = await pool.query(
      `SELECT current_streak, longest_streak, last_date
       FROM user_streaks WHERE user_id = $1`,
      [user_id]
    );

    res.json({
      success: true,
      total_rounds: totalRes.rows[0].total_rounds,
      daily: dailyRes.rows,
      streaks: streakRes.rows[0] || { current_streak: 0, longest_streak: 0 },
    });
  } catch (err) {
    console.error("❌ Error in /summary:", err);
    return res.status(500).json({ success: false, message: "Server error", detail: err.message });
  }
});

/* --------------------------------------------------------------------------
  GET /chanting/leaderboard
  Public endpoint
-------------------------------------------------------------------------- */
router.get("/leaderboard", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
         u.user_id,
         u.full_name,
         u.phone,
         COALESCE(SUM(c.rounds), 0) AS total_rounds,
         COALESCE(SUM(c.rounds) * 108, 0) AS total_beads,
         COALESCE(s.current_streak, 0) AS current_streak,
         COALESCE(s.longest_streak, 0) AS longest_streak
       FROM users u
       LEFT JOIN chant_entries c ON u.user_id = c.user_id
       LEFT JOIN user_streaks s ON u.user_id = s.user_id
       GROUP BY u.user_id, u.full_name, u.phone, s.current_streak, s.longest_streak
       ORDER BY total_beads DESC`
    );

    res.json({
      success: true,
      message: "Leaderboard fetched",
      data: result.rows,
    });
  } catch (err) {
    console.error("❌ Leaderboard error:", err);
    return res.status(500).json({ success: false, message: "Server error", detail: err.message });
  }
});

module.exports = router;
