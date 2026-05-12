const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "moe_transfer",
  password: "12345",
  port: 5432,
});

pool.connect()
  .then(() => console.log("PostgreSQL Connected ✅"))
  .catch(err => console.error("Database connection error ❌", err));

module.exports = pool;
