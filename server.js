require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || "moe_transfer_secret";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

pool
  .connect()
  .then(() => console.log("PostgreSQL Connected ✅"))
  .catch((err) => console.error("PostgreSQL Error:", err));

app.get("/", (req, res) => {
  res.send("Moe Transfer Backend Running ✅");
});

function auth(req, res, next) {
  const header = req.headers.authorization;

  if (!header) {
    return res.status(401).json({ message: "No token provided" });
  }

  const token = header.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
}

app.post("/register", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password required" });
    }

    const existingUser = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await pool.query(
      "INSERT INTO users (email, password, balance) VALUES ($1, $2, $3) RETURNING id, email, balance",
      [email, hashedPassword, 1000]
    );

    await pool.query(
      "INSERT INTO wallets (user_id, balance) VALUES ($1, $2)",
      [user.rows[0].id, 1000]
    );

    res.json({
      message: "Registration successful ✅",
      user: user.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Registration failed" });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await pool.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);

    if (user.rows.length === 0) {
      return res.status(400).json({ message: "User not found" });
    }

    const validPassword = await bcrypt.compare(password, user.rows[0].password);

    if (!validPassword) {
      return res.status(400).json({ message: "Wrong password" });
    }

    const token = jwt.sign(
      { id: user.rows[0].id, email: user.rows[0].email },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      message: "Login successful ✅",
      token,
      user: {
        id: user.rows[0].id,
        email: user.rows[0].email,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Login failed" });
  }
});

app.get("/dashboard", auth, async (req, res) => {
  try {
    const wallet = await pool.query(
      "SELECT balance FROM wallets WHERE user_id = $1",
      [req.user.id]
    );

    const transactions = await pool.query(
      "SELECT * FROM transactions WHERE sender_id = $1 OR receiver_id = $1 ORDER BY created_at DESC",
      [req.user.id]
    );

    res.json({
      balance: wallet.rows[0]?.balance || 0,
      transactions: transactions.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Dashboard failed" });
  }
});

app.post("/transfer", auth, async (req, res) => {
  try {
    const { receiverId, amount } = req.body;
    const sendAmount = Number(amount);

    if (!receiverId || !sendAmount || sendAmount <= 0) {
      return res.status(400).json({ message: "Invalid transfer" });
    }

    const senderWallet = await pool.query(
      "SELECT balance FROM wallets WHERE user_id = $1",
      [req.user.id]
    );

    if (senderWallet.rows.length === 0) {
      return res.status(400).json({ message: "Sender wallet not found" });
    }

    if (Number(senderWallet.rows[0].balance) < sendAmount) {
      return res.status(400).json({ message: "Insufficient balance" });
    }

    await pool.query("UPDATE wallets SET balance = balance - $1 WHERE user_id = $2", [
      sendAmount,
      req.user.id,
    ]);

    await pool.query("UPDATE wallets SET balance = balance + $1 WHERE user_id = $2", [
      sendAmount,
      receiverId,
    ]);

    await pool.query(
      "INSERT INTO transactions (sender_id, receiver_id, amount) VALUES ($1, $2, $3)",
      [req.user.id, receiverId, sendAmount]
    );

    res.json({ message: "Transfer successful ✅" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Transfer failed" });
  }
});

app.listen(PORT, () => {
  console.log(`Moe Transfer server running on port ${PORT}`);
});
