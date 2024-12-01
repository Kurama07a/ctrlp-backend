const WebSocket = require('ws');

// Establish a WebSocket connection
function connectWebSocket() {
    const wsUrl = process.env.WS_SERVER_URL || 'ws://localhost:8080';
    const ws = new WebSocket(wsUrl);

    ws.on('open', () => console.log('Connected to WebSocket server'));
    ws.on('close', () => {
        console.log('WebSocket connection closed');
        setTimeout(() => connectWebSocket(), 5000); // Attempt to reconnect after 5 seconds
    });
    ws.on('message', handleWebSocketMessage);
    ws.on('error', (err) => console.error('WebSocket error:', err));

    return ws;
}

// Handle incoming WebSocket messages
function handleWebSocketMessage(message) {
    const data = JSON.parse(message);
    console.log('Message from WebSocket server:', data);

    if (data.type === 'job_status_update') {
        updateJobStatusFromShop(data.jobIds, data.status);
    }
}

// Send payload to the WebSocket server
async function sendToWebSocket(ws, payload) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
        console.log(`Sent payload to WebSocket server: ${JSON.stringify(payload)}`);
    } else {
        console.error('WebSocket is not open. Failed to send message.');
    }
}

// Function to update job status from WebSocket messages
async function updateJobStatusFromShop(jobIds, status) {
    const { error } = await supabase
        .from('jobs')
        .update({ status })
        .in('job_id', jobIds);

    if (error) {
        console.error('Error updating job status from WebSocket message:', error);
    } else {
        console.log(`Successfully updated job statuses for jobs: ${jobIds.join(', ')}`);
    }
}

module.exports = { connectWebSocket, sendToWebSocket };
