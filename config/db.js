const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

console.log('DB: connecting to PostgreSQL via DATABASE_URL');

// Map MySQL-style camelCase column names to lowercase for PostgreSQL compatibility
// PostgreSQL stores unquoted identifiers as lowercase
function normalizeRows(rows) {
  if (!rows || !Array.isArray(rows)) return rows;
  return rows.map(row => {
    if (!row || typeof row !== 'object') return row;
    const normalized = {};
    for (const [key, val] of Object.entries(row)) {
      // Keep the original key but also add the camelCase version
      normalized[key] = val;
    }
    // Map common camelCase field names from their lowercase PG versions
    const camelMappings = {
      staffname: 'staffName',
      requestdate: 'requestDate',
      grandtotal: 'grandTotal',
      hodsignature: 'hodSignature',
      financesignature: 'financeSignature',
      directorsignature: 'directorSignature',
      created_at: 'created_at',
      updated_at: 'updated_at',
      password_hash: 'password_hash',
      must_reset_password: 'must_reset_password',
      reset_password_token: 'reset_password_token',
      reset_password_expires: 'reset_password_expires',
      otp_code: 'otp_code',
      otp_expires: 'otp_expires',
      signature_path: 'signature_path'
    };
    for (const [lcKey, ccKey] of Object.entries(camelMappings)) {
      if (lcKey in normalized && !(ccKey in normalized)) {
        normalized[ccKey] = normalized[lcKey];
      }
    }
    return normalized;
  });
}

function convertSql(sql) {
  let pg = sql;

  // Convert MySQL ? placeholders to PostgreSQL $1, $2, ...
  let i = 0;
  pg = pg.replace(/\?/g, () => `$${++i}`);

  // Remove MySQL backtick quoting
  pg = pg.replace(/`([^`]+)`/g, '$1');

  // Convert DATETIME to TIMESTAMP
  pg = pg.replace(/\bDATETIME\b/gi, 'TIMESTAMP');

  // Convert TINYINT(1) to SMALLINT
  pg = pg.replace(/TINYINT\(\d\)/gi, 'SMALLINT');

  // Convert MySQL double-quote string literals to single quotes
  // Only convert "string" that looks like a string value (not identifiers)
  // Handle: WHERE status = "PENDING_DIRECTOR"
  pg = pg.replace(/= "([^"]+)"/g, "= '$1'");

  // Convert IFNULL to COALESCE
  pg = pg.replace(/\bIFNULL\s*\(/gi, 'COALESCE(');

  // Convert department != "" to department != ''
  pg = pg.replace(/!= ""/g, "!= ''");

  // Quote camelCase column names in SQL so PostgreSQL preserves case
  const camelCols = ['staffName', 'requestDate', 'grandTotal', 'hodSignature', 'financeSignature', 'directorSignature'];
  for (const col of camelCols) {
    // Match the column name when used as an identifier (not inside quotes already)
    const re = new RegExp(`(?<!['"\\w])${col}(?!['"\\w])`, 'g');
    pg = pg.replace(re, `"${col}"`);
  }

  return pg;
}

module.exports = {
  execute: async (sql, params = []) => {
    const pgSql = convertSql(sql);
    try {
      const result = await pool.query(pgSql, params);
      const rows = normalizeRows(result.rows);
      return [rows, result.fields];
    } catch (err) {
      console.error('DB Error:', err.message);
      console.error('SQL:', pgSql);
      throw err;
    }
  },
  end: async () => {
    await pool.end();
  },
  pool
};
