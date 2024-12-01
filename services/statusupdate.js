const supabase = require('../config/supabaseClient');

async function updateJobStatus(req, res) {
    try {
        const { type, shopId, job_ids } = req.body;

        switch (type) {
            case 'JOB_RECEIVED':
                await handleJobReceived(job_ids, shopId);
                break;
            case 'JOB_COMPLETED':
                await handleJobCompleted(job_ids, shopId);
                break;
            case 'JOB_FAILED':
                await handleJobFailed(job_ids, shopId);
                break;
            default:
                return res.status(400).send('Invalid job status update type.');
        }

        console.log(`Job status update received for shop ${shopId}: ${type}`);
        res.status(200).send('Job status update processed.');
    } catch (error) {
        console.error('Error processing job status update:', error);
        res.status(500).send('Error processing job status update.');
    }
}

async function handleJobReceived(job_ids, shopId) {
    console.log(`Shop ${shopId} confirmed receipt of jobs: ${job_ids.join(', ')}`);

    const { error } = await supabase
        .from('jobs')
        .update({ status: 'IN_PROGRESS' })
        .in('job_id', job_ids);

    if (error) {
        console.error('Error updating job status to IN_PROGRESS:', error);
    }
}

async function handleJobCompleted(job_ids, shopId) {
    console.log(`Shop ${shopId} confirmed job completion: ${job_ids.join(', ')}`);

    const { error } = await supabase
        .from('jobs')
        .update({ status: 'COMPLETED' })
        .in('job_id', job_ids);

    if (error) {
        console.error('Error updating job status to COMPLETED:', error);
    }
}

async function handleJobFailed(job_ids, shopId) {
    console.log(`Shop ${shopId} reported job failure: ${job_ids.join(', ')}`);

    const { error } = await supabase
        .from('jobs')
        .update({ status: 'FAILED' })
        .in('job_id', job_ids);

    if (error) {
        console.error('Error updating job status to FAILED:', error);
    }
}

module.exports = updateJobStatus;
