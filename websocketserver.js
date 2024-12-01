require('dotenv').config();
const WebSocket = require('ws');
const supabase = require('./config/supabaseClient');

const wss = new WebSocket.Server({ port: process.env.WS_PORT || 8080 });

// Connection tracking
let shopConnections = new Map();
let apiConnections = [];

// Job tracking
let jobQueue = new Map(); // shopId -> Set of pending jobs
let jobRetries = new Map(); // jobId -> { attempts: number, timeout: timeoutId, lastAttempt: timestamp }
let activeSendOperations = new Map(); // shopId -> Set of jobs currently being sent

// Constants
const MAX_RETRIES = 3;
const RETRY_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const BATCH_SIZE = 50;
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

// WebSocket server setup
wss.on('connection', (ws, req) => {
    const urlPath = req.url || '';
    const pathParts = urlPath.split('/').filter(part => part);
    const shopId = pathParts[0];

    console.log(`Incoming connection from URL: ${urlPath}`);
    console.log(`Parsed shopId: ${shopId}`);

    if (shopId && !isNaN(shopId)) {
        console.log(`Shop service with ID ${shopId} connected.`);
        shopConnections.set(shopId, { ws, url: `ws://localhost:8080${req.url}` });
        
        // Initialize job queue for this shop if it doesn't exist
        if (!jobQueue.has(shopId)) {
            jobQueue.set(shopId, new Set());
        }
        
        // Initialize active operations tracking
        if (!activeSendOperations.has(shopId)) {
            activeSendOperations.set(shopId, new Set());
        }
        
        // Resend any pending jobs for this shop
        resendPendingJobs(shopId);
    } else {
        console.log('API service connected.');
        apiConnections.push(ws);
    }

    printConnectionMap();

    ws.on('message', async (message) => {
        try {
            const parsedMessage = JSON.parse(message);
            console.log(`Received message: ${message}`);

            if (shopId && !isNaN(shopId)) {
                await handleShopMessage(parsedMessage, shopId);
            } else {
                await handleApiMessage(parsedMessage);
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });

    ws.on('close', () => {
        if (shopId && !isNaN(shopId)) {
            console.log(`Shop service with ID ${shopId} disconnected.`);
            updateshopStatus(shopId, 'FALSE');
            shopConnections.delete(shopId);
        } else {
            console.log('API service disconnected.');
            apiConnections = apiConnections.filter(conn => conn !== ws);
        }
        printConnectionMap();
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// Message handlers
async function handleShopMessage(message, shopId) {
    switch (message.type) {
        case 'JOB_RECEIVED':
            await handleJobReceived(message, shopId);
            break;
        case 'JOB_COMPLETED':
            await handleJobCompleted(message, shopId);
            break;
        case 'JOB_FAILED':
            await handleJobFailed(message, shopId);
            break;
        case 'SHOP_OPEN':
            await handleshopopen(message, shopId);
            break;
        case 'SHOP_CLOSED':
            await handleshopclose(message, shopId);
            break;
        default:
            console.warn('Unknown message type from shop:', message.type);
    }
}

async function handleApiMessage(message) {
    if (message.type === 'new_jobs') {
        const { shopId, jobs } = message;
        console.log(`Received new jobs from API for shop ${shopId}.`);
        await sendJobsToShop(shopId, jobs);
    } else {
        console.warn('Unknown message type from API:', message.type);
    }
}

// Job queue management
function addJobsToQueue(shopId, jobs) {
    if (!jobQueue.has(shopId)) {
        jobQueue.set(shopId, new Set());
    }
    
    jobs.forEach(job => {
        jobQueue.get(shopId).add(job.job_id);
    });
}

function removeJobFromQueue(shopId, jobId) {
    if (jobQueue.has(shopId)) {
        jobQueue.get(shopId).delete(jobId);
    }
    
    // Clean up retry info
    const retryInfo = jobRetries.get(jobId);
    if (retryInfo && retryInfo.timeout) {
        clearTimeout(retryInfo.timeout);
    }
    jobRetries.delete(jobId);
}

// Job sending and retry logic
async function sendJobsToShop(shopId, jobs) {
    console.log(`Attempting to send jobs to shop ${shopId}`);
    
    const shopConnection = shopConnections.get(shopId.toString());
    if (!shopConnection) {
        console.error(`Cannot find connection for shop ${shopId}.`);
        return;
    }

    if (shopConnection.ws.readyState !== WebSocket.OPEN) {
        console.error(`Cannot send jobs to shop ${shopId}: Connection is not open. ReadyState: ${shopConnection.ws.readyState}`);
        return;
    }

    // Initialize active operations tracking if needed
    if (!activeSendOperations.has(shopId)) {
        activeSendOperations.set(shopId, new Set());
    }

    // Filter out jobs that are currently being sent
    const activeOps = activeSendOperations.get(shopId);
    const newJobs = jobs.filter(job => !activeOps.has(job.job_id));

    if (newJobs.length === 0) {
        console.log(`All jobs are currently being processed for shop ${shopId}`);
        return;
    }

    try {
        // Mark jobs as being sent
        newJobs.forEach(job => activeOps.add(job.job_id));

        console.log(`Sending ${newJobs.length} jobs to shop ${shopId}`);
        await new Promise((resolve, reject) => {
            shopConnection.ws.send(JSON.stringify({
                type: 'NEW_JOBS',
                jobs: newJobs,
                timestamp: Date.now()
            }), (error) => {
                if (error) reject(error);
                else resolve();
            });
        });

        console.log(`Jobs successfully sent to shop ${shopId}.`);
        
        // Add to queue and schedule retries
        addJobsToQueue(shopId, newJobs);
        scheduleJobRetry(shopId, newJobs);
        
    } catch (error) {
        console.error(`Error sending jobs to shop ${shopId}:`, error);
    } finally {
        // Clean up active operations tracking
        newJobs.forEach(job => activeOps.delete(job.job_id));
    }
}

function scheduleJobRetry(shopId, jobs) {
    jobs.forEach(job => {
        const retryInfo = jobRetries.get(job.job_id) || { 
            attempts: 0, 
            timeout: null,
            lastAttempt: Date.now()
        };
        
        // Clear existing timeout if any
        if (retryInfo.timeout) {
            clearTimeout(retryInfo.timeout);
        }

        // Schedule retry
        const timeoutId = setTimeout(async () => {
            // Check if enough time has passed since last attempt
            const timeSinceLastAttempt = Date.now() - retryInfo.lastAttempt;
            if (timeSinceLastAttempt < RETRY_TIMEOUT) {
                console.log(`Skipping retry for job ${job.job_id} - too soon since last attempt`);
                scheduleJobRetry(shopId, [job]); // Reschedule for later
                return;
            }

            if (jobQueue.get(shopId)?.has(job.job_id)) {
                retryInfo.attempts++;
                retryInfo.lastAttempt = Date.now();
                
                if (retryInfo.attempts < MAX_RETRIES) {
                    console.log(`Retrying job ${job.job_id} for shop ${shopId}. Attempt ${retryInfo.attempts + 1}/${MAX_RETRIES}`);
                    await sendJobsToShop(shopId, [job]);
                } else {
                    console.log(`Max retries reached for job ${job.job_id}. Marking as failed.`);
                    await handleJobFailed({ job_ids: [job.job_id] }, shopId);
                    removeJobFromQueue(shopId, job.job_id);
                }
            }
        }, RETRY_TIMEOUT);

        jobRetries.set(job.job_id, { ...retryInfo, timeout: timeoutId });
    });
}

async function resendPendingJobs(shopId) {
    const pendingJobs = jobQueue.get(shopId);
    if (pendingJobs && pendingJobs.size > 0) {
        console.log(`Resending ${pendingJobs.size} pending jobs to shop ${shopId}`);
        
        try {
            // Fetch full job details from database in batches
            const pendingJobsArray = Array.from(pendingJobs);
            
            for (let i = 0; i < pendingJobsArray.length; i += BATCH_SIZE) {
                const batch = pendingJobsArray.slice(i, i + BATCH_SIZE);
                const { data: jobs, error } = await supabase
                    .from('jobs')
                    .select('*')
                    .in('job_id', batch);
                
                if (error) {
                    console.error(`Error fetching pending jobs batch: ${error.message}`);
                    continue;
                }
                
                if (jobs && jobs.length > 0) {
                    // Small delay between batches to prevent overwhelming the connection
                    if (i > 0) await new Promise(resolve => setTimeout(resolve, 1000));
                    await sendJobsToShop(shopId, jobs);
                }
            }
        } catch (error) {
            console.error(`Error in resendPendingJobs: ${error.message}`);
        }
    }
}

// Shop status handlers
async function handleshopclose(message, shopId) {
    await updateshopStatus(shopId, 'FALSE');
}

async function handleshopopen(message, shopId) {    
    await updateshopStatus(shopId, 'TRUE');
}

async function updateshopStatus(shopId, status) {
    try {
        const { error } = await supabase
            .from('institute_print_shops')
            .update({ is_online: status })
            .eq('shop_id', shopId);

        if (error) {
            console.error(`Error updating shop status to ${status}:`, error);
        }
    } catch (error) {
        console.error(`Error updating shop status to ${status}:`, error);
    }
}

// Job status handlers
async function handleJobReceived(message, shopId) {
    const { job_ids } = message;
    console.log(`Shop ${shopId} confirmed receipt of jobs: ${job_ids.join(', ')}`);
    await updateJobStatus(job_ids, 'ASSIGNED');
}

async function handleJobCompleted(message, shopId) {
    const { job_ids } = message;
    console.log(`Shop ${shopId} confirmed job completion: ${job_ids.join(', ')}`);
    
    // Remove completed jobs from queue
    job_ids.forEach(jobId => removeJobFromQueue(shopId, jobId));
    
    await updateJobStatus(job_ids, 'COMPLETED');
}

async function handleJobFailed(message, shopId) {
    const { job_ids } = message;
    console.log(`Shop ${shopId} reported job failure: ${job_ids.join(', ')}`);
    
    // Remove failed jobs from queue
    job_ids.forEach(jobId => removeJobFromQueue(shopId, jobId));
    
    await updateJobStatus(job_ids, 'FAILED');
}

async function updateJobStatus(job_ids, status) {
    try {
        const { error } = await supabase
            .from('jobs')
            .update({ status: status })
            .in('job_id', job_ids);

        if (error) {
            console.error(`Error updating job status to ${status}:`, error);
        }
    } catch (error) {
        console.error(`Error updating job status to ${status}:`, error);
    }
}

// Utility functions
function printConnectionMap() {
    console.log('Current shopConnections map:');
    shopConnections.forEach((value, key) => {
        console.log(`Shop ID: ${key}`);
        console.log(`URL: ${value.url}`);
        console.log(`WebSocket ReadyState: ${value.ws.readyState}`);
        console.log(`Pending jobs: ${jobQueue.get(key)?.size || 0}`);
    });
}

// Cleanup interval
setInterval(() => {
    activeSendOperations.forEach((ops, shopId) => {
        if (ops.size > 0) {
            console.log(`Cleaning up stale active operations for shop ${shopId}`);
            ops.clear();
        }
    });
}, CLEANUP_INTERVAL);

// Start server
console.log(`WebSocket server running on port ${process.env.WS_PORT || 8080}`);