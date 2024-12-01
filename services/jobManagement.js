const supabase = require('../config/supabaseClient');
const { sendToWebSocket } = require('./websocketclient');

async function processJobs(ws) {
    try {
        const jobs = await fetchJobsByStatus('UPLOADED');

        if (!jobs.length) {
            console.log('No jobs to process.');
            return;
        }

        const groupedJobs = groupJobsByShop(jobs);

        for (const [shopId, shopJobs] of Object.entries(groupedJobs)) {
            await sendJobsToWebSocket(ws, shopId, shopJobs);
        }

        console.log('Job processing completed.');
    } catch (error) {
        console.error('Error in job processing:', error);
    }
}

async function fetchJobsByStatus(status) {
    const { data: jobs, error } = await supabase
        .from('jobs')
        .select('*')
        .eq('status', status)
        .order('created_at', { ascending: true });

    if (error) throw new Error(`Error fetching jobs: ${error.message}`);
    return jobs;
}

function groupJobsByShop(jobs) {
    return jobs.reduce((acc, job) => {
        if (!acc[job.shop_id]) {
            acc[job.shop_id] = [];
        }
        acc[job.shop_id].push(job);
        return acc;
    }, {});
}

async function sendJobsToWebSocket(ws, shopId, jobs) {
    const payload = {
        type: 'new_jobs',
        shopId: shopId,
        jobs: jobs.map(job => ({
            job_id: job.job_id,
            shop_id: job.shop_id,  // Added this line
            size: job.size,
            copies: job.copies,
            start_page: job.start_page,
            end_page: job.end_page,
            file: job.combined_file,
            color_mode: job.color_mode,
            orientation: job.orientation,
            paper_size: job.paper_size,
            duplex: job.duplex,
            source: job.source,
            user: job.uid,
        })),
    };

    await sendToWebSocket(ws, payload);

    for (const job of jobs) {
        await assignJob(job);
        await updateJobStatus(job.job_id, 'IN TRANSITION');
        await updateShopWorkload(job.shop_id, job.size, job.copies);
    }
}

async function assignJob(job) {
    const { error } = await supabase
        .from('job_assignment')
        .insert({
            job_id: job.job_id,
            shop_id: job.shop_id,
            uid: job.uid,
            created_at: new Date().toISOString(),
        });

    if (error) throw new Error(`Error inserting job assignment: ${error.message}`);
}

async function updateJobStatus(jobId, status) {
    const { error } = await supabase
        .from('jobs')
        .update({ status })
        .eq('job_id', jobId);

    if (error) throw new Error(`Error updating job status: ${error.message}`);
}

async function updateShopWorkload(shopId, jobSize, copies) {
    const { data: shop, error: fetchError } = await supabase
        .from('institute_print_shops')
        .select('current_workload')
        .eq('shop_id', shopId)
        .single();

    if (fetchError) throw new Error(`Error fetching shop data: ${fetchError.message}`);

    const newWorkload = shop.current_workload + jobSize * copies;

    const { error: updateError } = await supabase
        .from('institute_print_shops')
        .update({ current_workload: newWorkload })
        .eq('shop_id', shopId);

    if (updateError) throw new Error(`Error updating shop workload: ${updateError.message}`);
}

module.exports = { processJobs };