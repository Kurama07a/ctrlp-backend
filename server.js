require('dotenv').config();  // Load environment variables
import express, { json } from 'express';
import supabase from './config/supabaseClient';
const app = express();
app.use(json());

const PORT = process.env.PORT || 3000;

// API logic goes here...

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});