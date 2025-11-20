const express = require("express");
const router = express.Router();
const pool = require("../db");
const jwt = require("jsonwebtoken");

const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader)
    return res.status(401).json({ success: false, message: "Missing token" });

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user_id = decoded.user_id;  // 🔥 FIXED
    next();
  } catch (err) {
    return res.status(403).json({ success: false, message: "Invalid token" });
  }
};

router.post("/add", authMiddleware, async (req, res) => {
  try {
    const { rounds, chant_date } = req.body;
    const user_id = req.user.user_id;

    if (!rounds || rounds <= 0) {
      return res.status(400).json({
        success: false,
        message: "Rounds required",
      });
    }

    // 📌 Use selected date or today's date
    const chantDate = chant_date ? new Date(chant_date) : new Date();
    const todayStr = chantDate.toISOString().split("T")[0];

    // 📌 Add Chant Entry
    const entry = await pool.query(
      `INSERT INTO chant_entries (user_id, rounds, created_at)
       VALUES ($1, $2, $3)
       RETURNING entry_id, rounds, created_at`,
      [user_id, rounds, chantDate]
    );

    // 📌 Fetch streak row
    const streakRow = await pool.query(
      `SELECT current_streak, longest_streak, last_date
       FROM user_streaks
       WHERE user_id = $1`,
      [user_id]
    );

    let currentStreak = 1;
    let longestStreak = 1;

    if (streakRow.rows.length > 0) {
      const prevDate = streakRow.rows[0].last_date; // This is a STRING in Neon!
      const prevDateStr = prevDate ? new Date(prevDate).toISOString().split("T")[0] : null;

      // Calculate yesterday
      const yesterday = new Date(chantDate);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split("T")[0];

      // If last entry was yesterday → streak continues
      if (prevDateStr === yesterdayStr) {
        currentStreak = streakRow.rows[0].current_streak + 1;
      } else {
        currentStreak = 1;
      }

      // Recalculate longest streak
      longestStreak = Math.max(streakRow.rows[0].longest_streak, currentStreak);

      // Update streak record
      await pool.query(
        `UPDATE user_streaks
         SET current_streak = $1, longest_streak = $2, last_date = $3
         WHERE user_id = $4`,
        [currentStreak, longestStreak, todayStr, user_id]
      );
    } else {
      // First ever chant
      await pool.query(
        `INSERT INTO user_streaks (user_id, current_streak, longest_streak, last_date)
         VALUES ($1, 1, 1, $2)`,
        [user_id, todayStr]
      );
    }

    return res.json({
      success: true,
      message: "Chant entry added",
      entry: entry.rows[0],
      streaks: { currentStreak, longestStreak },
    });

  } catch (err) {
    console.error("❌ Error in /add:", err);
    res.status(500).json({
      success: false,
      message: "Server error adding chant",
    });
  }
});



router.get("/summary", authMiddleware, async (req, res) => {
  try {
    const user_id = req.user_id;

    const total = await pool.query(
      `SELECT COALESCE(SUM(rounds), 0) AS total_rounds
       FROM chant_entries WHERE user_id = $1`,
      [user_id]
    );

    const daily = await pool.query(
      `SELECT DATE(created_at) AS date, SUM(rounds) AS rounds
       FROM chant_entries
       WHERE user_id = $1
       GROUP BY DATE(created_at)
       ORDER BY date DESC`,
      [user_id]
    );

    const streaks = await pool.query(
      `SELECT current_streak, longest_streak, last_date
       FROM user_streaks WHERE user_id = $1`,
      [user_id]
    );

    res.json({
      success: true,
      total_rounds: total.rows[0].total_rounds,
      daily: daily.rows,
      streaks: streaks.rows[0] || {
        current_streak: 0,
        longest_streak: 0,
      },
    });
  } catch (err) {
    console.error("❌ Error in /summary:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


router.get("/leaderboard", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
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
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
