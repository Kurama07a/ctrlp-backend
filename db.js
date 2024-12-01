require('dotenv').config();
const { Pool } = require('pg');

// Create a connection pool to the PostgreSQL database
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false, // This is important when using Supabase or cloud databases
    },
});

// Export the pool to be used in other files
module.exports = {
    query: (text, params) => pool.query(text, params),
};
