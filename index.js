require('dotenv').config(); // Load environment variables
const express = require('express');
const { processJobs } = require('./services/jobManagement');
const { connectWebSocket } = require('./services/websocketclient');
const supabase = require('./config/supabaseClient'); // Fetch job data
const WebSocket = require('ws'); // Add this line to import WebSocket
const app = express();
const port = process.env.PORT || 3000;

// Maintain WebSocket connection
let ws = connectWebSocket();

// Reconnect logic if WebSocket connection is lost
function maintainWebSocketConnection() {
    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        console.log('Reconnecting to WebSocket server...');
        ws = connectWebSocket();
    }
}

setInterval(maintainWebSocketConnection, 5000);

// Middleware to parse JSON request bodies
app.use(express.json());

// Health check route for the API
app.get('/health', (req, res) => {
    res.status(200).send({ status: 'API is running', timestamp: new Date().toISOString() });
});

// Fetch all jobs from the database
app.get('/jobs', async (req, res) => {
    try {
        const { data: jobs, error } = await supabase
            .from('jobs')
            .select('*');

        if (error) throw new Error(error.message);

        res.status(200).json(jobs);
    } catch (err) {
        console.error('Error fetching jobs:', err);
        res.status(500).json({ error: 'Failed to fetch jobs' });
    }
});

// Manually trigger job processing
app.get('/process-jobs', async (req, res) => {
    try {
        await processJobs(ws);
        res.status(200).send('Job processing started.');
    } catch (error) {
        console.error('Error processing jobs:', error);
        res.status(500).send('Error processing jobs.');
    }
});

// Route to update job statuses
app.post('/update-job-status', require('./services/statusUpdate'));

// Uncomment the line below to automatically process jobs every minute
setInterval(() => processJobs(ws), 10000); // every 60 seconds

// Start the server
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
