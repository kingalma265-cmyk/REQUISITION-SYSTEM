// const mysql = require('mysql2');

// const pool = mysql.createPool({
//     host: 'localhost',
//     user: 'root',      // Your MySQL username
//     password: 'yourpassword', 
//     database: 'octagon_db'
// });

// module.exports = pool.promise();

const mysql = require('mysql2');

// Create the connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',          // Your MySQL username
  password: process.env.DB_PASSWORD || 'root123', // Your MySQL password
  database: process.env.DB_NAME || 'octagon_requisition',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

console.log('DB: connecting with', {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  database: process.env.DB_NAME || 'octagon_requisition'
});

if ((process.env.DB_PASSWORD || '') === '') {
  console.warn('DB WARNING: replace config/db.js password with your real MySQL password or set DB_PASSWORD env var.');
}

// Export the promise-based version for async/await
module.exports = pool.promise();