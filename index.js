const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const authRoutes = require("./routes/authRoutes");
const chantingRoutes = require("./routes/chantingRoutes");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.use("/auth", authRoutes);
app.use("/chanting", chantingRoutes);

app.listen(3000, '0.0.0.0', () => console.log("Server running on port 3000"));
