require("dotenv").config();
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/authRoutes");
const chantingRoutes = require("./routes/chantingRoutes");

const app = express();

app.use(cors({ origin: "*" }));
app.use(express.json());              
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.send("💚 Backend is running successfully!");
});

app.use("/auth", authRoutes);
app.use("/chanting", chantingRoutes);

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
