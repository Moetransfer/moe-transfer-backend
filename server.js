require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const { Pool } = require("pg");

const app = express();

app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const JWT_SECRET = "moe_transfer_secret_key";

console.log("Moe Transfer server running on port 4000");

pool.connect()
  .then(() => console.log("PostgreSQL Connected ✅"))
  .catch((err) => console.log(err));



/* =========================
   REGISTER
========================= */

app.post("/register", async (req, res) => {
  try {
    const { email, password } = req.body;

    const existingUser = await pool.query(
      "SELECT * FROM users WHERE email=$1",
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        message: "User already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query(
      "INSERT INTO users (email, password, balance) VALUES ($1, $2, $3)",
      [email, hashedPassword, 1000]
    );

    res.json({
      message: "Registration successful ✅",
    });

  } catch (err) {
    console.log(err);

    res.status(500).json({
      message: "Server error",
    });
  }
});



/* =========================
   LOGIN
========================= */

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await pool.query(
      "SELECT * FROM users WHERE email=$1",
      [email]
    );

    if (user.rows.length === 0) {
      return res.status(400).json({
        message: "User not found",
      });
    }

    const validPassword = await bcrypt.compare(
      password,
      user.rows[0].password
    );

    if (!validPassword) {
      return res.status(400).json({
        message: "Wrong password",
      });
    }

    const token = jwt.sign(
      {
        id: user.rows[0].id,
      },
      JWT_SECRET
    );

    res.json({
      message: "Login successful ✅",
      token,
    });

  } catch (err) {
    console.log(err);

    res.status(500).json({
      message: "Server error",
    });
  }
});



/* =========================
   AUTH MIDDLEWARE
========================= */

const auth = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).json({
        message: "No token",
      });
    }

    const verified = jwt.verify(token, JWT_SECRET);

    req.user = verified;

    next();

  } catch (err) {
    res.status(401).json({
      message: "Invalid token",
    });
  }
};



/* =========================
   DASHBOARD
========================= */

app.get("/dashboard", auth, async (req, res) => {
  try {

    const user = await pool.query(
      "SELECT balance FROM users WHERE id=$1",
      [req.user.id]
    );

    const transactions = await pool.query(
      "SELECT * FROM transactions WHERE sender_id=$1 ORDER BY id DESC",
      [req.user.id]
    );

    res.json({
      balance: user.rows[0].balance,
      transactions: transactions.rows,
    });

  } catch (err) {
    console.log(err);

    res.status(500).json({
      message: "Server error",
    });
  }
});



/* =========================
   TRANSFER
========================= */

app.post("/transfer", auth, async (req, res) => {
  try {

    const senderId = req.user.id;

    const { receiverId, amount } = req.body;

    const sender = await pool.query(
      "SELECT * FROM users WHERE id=$1",
      [senderId]
    );

    if (sender.rows[0].balance < amount) {
      return res.status(400).json({
        message: "Insufficient balance",
      });
    }

    await pool.query(
      "UPDATE users SET balance = balance - $1 WHERE id=$2",
      [amount, senderId]
    );

    await pool.query(
      "UPDATE users SET balance = balance + $1 WHERE id=$2",
      [amount, receiverId]
    );

    await pool.query(
      "INSERT INTO transactions (sender_id, receiver_id, amount) VALUES ($1, $2, $3)",
      [senderId, receiverId, amount]
    );

    res.json({
      message: "Transfer successful ✅",
    });

  } catch (err) {
    console.log(err);

    res.status(500).json({
      message: "Transfer failed",
    });
  }
});



app.listen(4000, () => {
  console.log("Server running on port 4000");
});
