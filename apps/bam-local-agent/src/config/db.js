import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 5, // shared hosting: keep the pool small
  queueLimit: 0,
  connectTimeout: 10_000,
  charset: 'utf8mb4'
});

export default pool;
