require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const Stripe = require("stripe");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "moe_transfer_secret"
    );

    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
};

const adminOnly = (req, res, next) => {
  if (req.user.email?.toLowerCase() !== "djmoe20@yahoo.com") {
    return res.status(403).json({ error: "Admin only" });
  }

  next();
};

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const isLocal = process.env.DATABASE_URL?.includes("localhost");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

pool.connect()
  .then(() => console.log("PostgreSQL Connected ✅"))
  .catch((err) => console.log("PostgreSQL Error:", err));

async function setupTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT,
      username TEXT,
      email TEXT UNIQUE,
      password TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS transfers (
      id SERIAL PRIMARY KEY,
      user_email TEXT,
      receiver_name TEXT,
      bank_name TEXT,
      account_number TEXT,
      country TEXT,
      amount TEXT,
      received TEXT,
      symbol TEXT,
      reference TEXT,
      status TEXT,
      date TEXT,
      time TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

await pool.query(`
CREATE TABLE IF NOT EXISTS recipients (
    id SERIAL PRIMARY KEY,
    user_email TEXT,
    recipient_name TEXT,
    bank_name TEXT,
    account_number TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
`);

  console.log("Users table ready ✅");
  console.log("Transfers table ready ✅");
  console.log("Recipients table ready ✅");
}

setupTables();

app.get("/", (req, res) => {
  res.send("Moe Transfer backend running 🚀");
});

app.post("/signup", async (req, res) => {
  try {
    const { name, username, email, password } = req.body;
    const finalName = name || username;

    if (!finalName || !email || !password) {
      return res.status(400).json({ error: "All fields required" });
    }

    const existingUser = await pool.query("SELECT * FROM users WHERE email=$1", [email]);

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: "User already exists" });
    }

    const result = await pool.query(
      `INSERT INTO users (name, username, email, password)
       VALUES ($1,$2,$3,$4)
       RETURNING id, name, username, email`,
      [finalName, finalName, email, password]
    );

    const token = jwt.sign(
  { email: result.rows[0].email },
  process.env.JWT_SECRET || "moe_transfer_secret",
  { expiresIn: "7d" }
);

res.json({
  success: true,
  token,
  user: result.rows[0]
});
  } catch (error) {
    console.log("Signup error:", error);
    res.status(500).json({ error: "Signup failed" });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query(
      "SELECT id, name, username, email FROM users WHERE email=$1 AND password=$2",
      [email, password]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = jwt.sign(
  { email: result.rows[0].email },
  process.env.JWT_SECRET || "moe_transfer_secret",
  { expiresIn: "7d" }
);

res.json({
  success: true,
  token,
  user: result.rows[0]
});
  } catch (error) {
    console.log("Login error:", error);
    res.status(500).json({ error: "Login failed" });
  }
});

app.post("/create-payment-intent", async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(Number(amount) * 100),
      currency: "eur",
      automatic_payment_methods: {
        enabled: true,
      },
    });

    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    console.log("Stripe error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/transfers", async (req, res) => {
  try {
    const {
      userEmail,
      receiverName,
      bankName,
      accountNumber,
      country,
      amount,
      received,
      symbol,
      reference,
      status,
      date,
      time,
    } = req.body;

    const result = await pool.query(
      `INSERT INTO transfers (
        user_email, receiver_name, bank_name, account_number,
        country, amount, received, symbol, reference, status, date, time
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *`,
      [
        userEmail,
        receiverName,
        bankName,
        accountNumber,
        country,
        amount,
        received,
        symbol,
        reference,
        status,
        date,
        time,
      ]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.log("Save transfer error:", error);
    res.status(500).json({ error: "Transfer failed" });
  }
});

 app.get("/transfers", auth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM transfers WHERE user_email=$1 ORDER BY id DESC",
      [req.user.email]
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch transfers" });
  }
});

app.post("/create-checkout-session", async (req, res) => {
  try {
    const { amount, recipient } = req.body;

    const session = await stripe.checkout.sessions.create({
  payment_method_types: ["card"],
  mode: "payment",

  line_items: [
    {
      price_data: {
        currency: "eur",
        product_data: {
          name: `Moe Transfer to ${recipient || "recipient"}`
        },
        unit_amount: Math.round(Number(amount) * 100),
      },
      quantity: 1,
    },
  ],

  success_url: "https://moe-transfer-frontend.onrender.com?payment=success",
  cancel_url: "https://moe-transfer-frontend.onrender.com?payment=cancel",
});

    res.json({ url: session.url });
  } catch (error) {
    console.error("Stripe checkout error:", error);
    res.status(500).json({ error: error.message });
  }
});
app.get("/recipients", auth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM recipients WHERE user_email=$1 ORDER BY id DESC",
      [req.user.email]
    );

    res.json(result.rows);
  } catch (error) {
    console.log("Fetch recipients error:", error);
    res.status(500).json({ error: "Failed to fetch recipients" });
  }
});

app.post("/recipients", auth, async (req, res) => {
  try {
    const { recipientName, bankName, accountNumber } = req.body;

    const result = await pool.query(
      `INSERT INTO recipients
      (user_email, recipient_name, bank_name, account_number)
      VALUES ($1,$2,$3,$4)
      RETURNING *`,
      [req.user.email, recipientName, bankName, accountNumber]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.log("Save recipient error:", error);
    res.status(500).json({ error: "Failed to save recipient" });
  }
});

app.get("/admin/stats", auth, adminOnly, async (req, res) => {
  try {
    const users = await pool.query(
      "SELECT COUNT(*) FROM users"
    );

    const transfers = await pool.query(
      "SELECT COUNT(*) FROM transfers"
    );

    const volume = await pool.query(
  "SELECT COALESCE(SUM(amount),0) AS total FROM transfers"
);

    res.json({
      users: users.rows[0].count,
      transfers: transfers.rows[0].count,
      volume: volume.rows[0].total
    });

  } catch (error) {
    console.log("ADMIN STATS ERROR:", error);
    res.status(500).json({
      error: "Failed to load admin stats"
    });
  }
});

app.get("/admin/transfers", auth, adminOnly, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM transfers ORDER BY id DESC");
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: "Failed to load admin transfers" });
  }
});
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} 🚀`);
});
