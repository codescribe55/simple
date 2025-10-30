const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const messageRoutes = require("./routes/messageRoutes");

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.use("/messages", messageRoutes);

app.listen(3000, '0.0.0.0', () => console.log("Server running on port 3000"));

