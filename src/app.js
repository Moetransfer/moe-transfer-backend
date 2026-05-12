const express = require("express");
const cors = require("cors");
require("dotenv").config();

const db = require("./config/db");
const { registerUser, loginUser } = require("./controllers/authController");

const app = express();

app.use(cors());
app.use(express.json());

app.post("/api/auth/register", registerUser);
app.post("/api/auth/login", loginUser);

app.get("/", (req, res) => {
  res.json({ message: "Moe Transfer API is running 🚀" });
});

module.exports = app;
