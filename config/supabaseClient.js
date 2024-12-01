require('dotenv').config();  // Load environment variables

const { createClient } = require('@supabase/supabase-js');

// Supabase URL and Key from environment variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

// Initialize Supabase client
const supabase = createClient(supabaseUrl, supabaseKey);

// Export the Supabase client
module.exports = supabase;