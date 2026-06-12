const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'octagon_requisition',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

console.log('DB: connected to MySQL via mysql2');

function normalizeRows(rows) {
  if (!rows || !Array.isArray(rows)) return rows;
  return rows;
}

module.exports = {
  execute: async (sql, params = []) => {
    try {
      const [rows, fields] = await pool.execute(sql, params);
      return [normalizeRows(rows), fields];
    } catch (err) {
      console.error('DB Error:', err.message);
      console.error('SQL:', sql);
      throw err;
    }
  },
  end: async () => {
    await pool.end();
  },
  pool
};
