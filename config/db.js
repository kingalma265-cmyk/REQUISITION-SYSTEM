const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('sslmode=require')
    ? { rejectUnauthorized: false }
    : false
});

console.log('DB: connected to PostgreSQL via pg');

function mysqlToPostgres(sql) {
  // 1. Replace ? placeholders with $1, $2, ...
  let i = 0;
  sql = sql.replace(/\?/g, () => `$${++i}`);

  // 2. Replace backtick identifiers with double-quotes
  sql = sql.replace(/`([^`]+)`/g, '"$1"');

  // 3. IFNULL -> COALESCE
  sql = sql.replace(/\bIFNULL\s*\(/gi, 'COALESCE(');

  // 4. MySQL double-quoted string values (e.g. = "PENDING_HOD") -> single quotes
  //    Only match where the double-quoted value is used as a SQL value (after = or IN etc.)
  sql = sql.replace(/(?<==\s*)"([^"]+)"/g, "'$1'");

  // 5. Unquoted camelCase column names in ORDER BY, SELECT, SET, WHERE, etc.
  //    Quote known camelCase columns used in this app
  const camelCols = [
    'staffName', 'requestDate', 'grandTotal',
    'hodSignature', 'financeSignature', 'directorSignature'
  ];
  for (const col of camelCols) {
    // Quote only when used as a bare identifier (not already quoted, not inside strings)
    sql = sql.replace(new RegExp(`(?<!["'])\\b${col}\\b(?!["'])`, 'g'), `"${col}"`);
  }

  // 6. department != "" -> department != '' (MySQL empty string to PG)
  sql = sql.replace(/department != ""/g, "department != ''");
  sql = sql.replace(/department = ""/g, "department = ''");

  return sql;
}

module.exports = {
  execute: async (sql, params = []) => {
    try {
      const pgSql = mysqlToPostgres(sql);
      const result = await pool.query(pgSql, params.length > 0 ? params : undefined);

      // Emulate MySQL2's [rows, fields] return format
      // Also emulate insertId for INSERT ... RETURNING id
      return [result.rows, result.fields];
    } catch (err) {
      console.error('DB Error:', err.message);
      console.error('Original SQL:', sql);
      throw err;
    }
  },

  // For INSERTs that need the new row ID, use this method
  executeInsert: async (sql, params = []) => {
    try {
      // Append RETURNING id if not present
      let pgSql = mysqlToPostgres(sql);
      if (!/RETURNING/i.test(pgSql)) {
        pgSql = pgSql.replace(/;?\s*$/, ' RETURNING id');
      }
      const result = await pool.query(pgSql, params.length > 0 ? params : undefined);
      const rows = result.rows;
      if (rows.length > 0) {
        rows.insertId = rows[0].id;
      }
      return [rows, result.fields];
    } catch (err) {
      console.error('DB Insert Error:', err.message);
      console.error('Original SQL:', sql);
      throw err;
    }
  },

  end: async () => {
    await pool.end();
  },
  pool
};
