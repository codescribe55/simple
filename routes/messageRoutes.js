const express = require("express");
const router = express.Router();
const pool = require("../db");

router.post("/add", async (req, res) => {
  const { content } = req.body;
  try {
    await pool.query("INSERT INTO messages (content) VALUES ($1)", [content]);
    res.json({ success: true, message: "Message saved!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/all", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM messages ORDER BY id DESC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
