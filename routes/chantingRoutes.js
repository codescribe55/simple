const express = require("express");
const router = express.Router();
const pool = require("../db");
const admin = require("../services/firebaseService");

// 🧘 Add or update chanting record
router.post("/addChant", async (req, res) => {
  try {
    const { idToken, chant_date, rounds } = req.body;

    if (!idToken || rounds == null) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    const decoded = await admin.auth().verifyIdToken(idToken);
    const phone_number = decoded.phone_number;

    if (!phone_number) {
      return res.status(400).json({ success: false, message: "Phone number not found in token" });
    }

    const chantDate = chant_date ? new Date(chant_date).toISOString().split("T")[0] : new Date().toISOString().split("T")[0];

    const existing = await pool.query(
      "SELECT rounds FROM chanting_records WHERE phone_number = $1 AND chant_date = $2",
      [phone_number, chantDate]
    );

    if (existing.rows.length > 0) {
      const updatedRounds = existing.rows[0].rounds + rounds;
      await pool.query(
        `UPDATE chanting_records SET rounds = $1, updated_at = NOW() WHERE phone_number = $2 AND chant_date = $3`,
        [updatedRounds, phone_number, chantDate]
      );
      return res.json({ success: true, message: "Chant count updated successfully", data: { total_for_day: updatedRounds } });
    } else {
      await pool.query(
        `INSERT INTO chanting_records (phone_number, chant_date, rounds) VALUES ($1, $2, $3)`,
        [phone_number, chantDate, rounds]
      );
      return res.json({ success: true, message: "Chant record added successfully", data: { total_for_day: rounds } });
    }
  } catch (error) {
    console.error("❌ Error in /addChant:", error);
    res.status(500).json({ success: false, message: "Server error while adding chant record" });
  }
});

// 📊 Get chanting summary (total + per-day)
router.get("/getChantSummary/:phone_number", async (req, res) => {
  try {
    const { phone_number } = req.params;

    if (!phone_number) {
      return res.status(400).json({
        success: false,
        message: "Phone number required",
      });
    }

    const { rows: records } = await pool.query(
      "SELECT chant_date, rounds FROM chanting_records WHERE phone_number = $1 ORDER BY chant_date DESC",
      [phone_number]
    );

    const { rows: total } = await pool.query(
      "SELECT COALESCE(SUM(rounds), 0) AS total_rounds FROM chanting_records WHERE phone_number = $1",
      [phone_number]
    );

    res.json({
      success: true,
      message: "Chanting summary fetched successfully",
      total_rounds: total[0].total_rounds,
      records,
    });
  } catch (error) {
    console.error("❌ Error in /getChantSummary:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching chanting data",
    });
  }
});

router.get("/leaderboard", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      WITH streaks AS (
        SELECT 
          phone_number,
          chant_date,
          LAG(chant_date) OVER (PARTITION BY phone_number ORDER BY chant_date) AS prev_date
        FROM chanting_records
      ),
      consecutive_days AS (
        SELECT 
          phone_number,
          COUNT(*) AS streak_days
        FROM streaks
        WHERE chant_date - COALESCE(prev_date, chant_date - INTERVAL '1 day') = INTERVAL '1 day'
        GROUP BY phone_number
      )
      SELECT 
        u.username,
        u.phone_number,
        COALESCE(SUM(c.rounds), 0) AS total_malas,
        COALESCE(SUM(c.rounds) * 108, 0) AS total_beads,
        COALESCE(cd.streak_days, 0) AS streak_days
      FROM users u
      LEFT JOIN chanting_records c ON u.phone_number = c.phone_number
      LEFT JOIN consecutive_days cd ON u.phone_number = cd.phone_number
      GROUP BY u.username, u.phone_number, cd.streak_days
      ORDER BY total_beads DESC;
    `);

    res.json({
      success: true,
      message: "Leaderboard data fetched successfully",
      data: rows,
    });
  } catch (error) {
    console.error("❌ Error in /leaderboard:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching leaderboard data",
    });
  }
});


module.exports = router;
