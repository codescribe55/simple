const { Pool } = require("pg");

const pool = new Pool({
  user: 'postgres',           // your pg username
  host: '127.0.0.1',          // or 127.0.0.1
  database: 'simple',    // your db name
  password: 'root',   // password you set for postgres
  port: 5432,                 // default port
});


module.exports = pool;
