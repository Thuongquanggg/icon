
// functions/loop-handler.js

// !!! PHIÊN BẢN KHÔNG AN TOÀN - TOKEN ĐƯỢC DÁN TRỰC TIẾP VÀO ĐÂY !!!
const GITHUB_TOKEN = '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';

// =================================================================
// Cảnh báo: KHÔNG BAO GIỜ đưa mã này lên GitHub công khai.
// Khi triển khai chính thức, hãy xóa dòng trên và sử dụng phương pháp an toàn:
// const GITHUB_TOKEN = process.env.GITHUB_TOKEN_SECRET;
// =================================================================


let loopState = { isRunning: false, workflowId: null, currentRunId: null, timeoutId: null };
const RUN_INTERVAL = 2 * 60 * 1000; // 2 phút

async function githubApi(endpoint, token, options = {}) {
    const API_URL = 'https://api.github.com/repos/Thuongquanggg/Test'; // Thay repo nếu cần
    const response = await fetch(`${API_URL}${endpoint}`, {
        headers: {
            'Accept': 'application/vnd.github.v3+json',
            'Authorization': `token ${token}`,
            'X-GitHub-Api-Version': '2022-11-28'
        },
        ...options
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(`Lỗi API (${response.status}): ${error.message}`);
    }
    return response.status === 204 ? null : response.json();
}

async function findLatestRunForWorkflow(workflowId, token) {
    const data = await githubApi(`/actions/workflows/${workflowId}/runs?per_page=5`, token);
    const runs = (data.workflow_runs || []).filter(run => ['queued', 'in_progress'].includes(run.status));
    return runs.length > 0 ? runs[0] : null;
}

async function executeLoopCycle(token) {
    if (!loopState.isRunning) { console.log("Server: Vòng lặp đã dừng."); return; }
    try {
        console.log(`Server: Chạy workflow ${loopState.workflowId}`);
        await githubApi(`/actions/workflows/${loopState.workflowId}/dispatches`, token, { method: 'POST', body: JSON.stringify({ ref: 'main' }) });
        await new Promise(resolve => setTimeout(resolve, 5000));
        const latestRun = await findLatestRunForWorkflow(loopState.workflowId, token);
        if (latestRun) {
            loopState.currentRunId = latestRun.id;
            console.log(`Server: Run ID mới: ${loopState.currentRunId}. Chờ 2 phút.`);
            loopState.timeoutId = setTimeout(async () => {
                if (!loopState.isRunning) return;
                try {
                    console.log(`Server: Hết giờ. Dừng run ID: ${loopState.currentRunId}`);
                    await githubApi(`/actions/runs/${loopState.currentRunId}/cancel`, token, { method: 'POST' });
                } catch (e) { console.error(`Server: Lỗi khi dừng run:`, e.message); }
                executeLoopCycle(token);
            }, RUN_INTERVAL);
        } else {
            console.error("Server: Không tìm thấy run mới. Thử lại sau 30 giây.");
            loopState.timeoutId = setTimeout(() => executeLoopCycle(token), 30000);
        }
    } catch (e) {
        console.error("Server: Lỗi nghiêm trọng trong chu kỳ:", e);
        loopState.timeoutId = setTimeout(() => executeLoopCycle(token), 30000);
    }
}

exports.handler = async (event) => {
    // Mã này sẽ sử dụng biến GITHUB_TOKEN đã được khai báo ở trên cùng của file.
    
    if (!GITHUB_TOKEN) {
        return { statusCode: 500, body: JSON.stringify({ message: "Thiếu token GitHub trong file loop-handler.js." }) };
    }
    const { action, workflowId } = JSON.parse(event.body);

    if (action === 'start') {
        if (loopState.isRunning) return { statusCode: 400, body: JSON.stringify({ message: "Vòng lặp đã chạy rồi." }) };
        loopState.isRunning = true;
        loopState.workflowId = workflowId;
        executeLoopCycle(GITHUB_TOKEN);
        return { statusCode: 200, body: JSON.stringify({ message: `Đã bắt đầu vòng lặp.` }) };
    }
    if (action === 'stop') {
        if (!loopState.isRunning) return { statusCode: 400, body: JSON.stringify({ message: "Vòng lặp chưa chạy." }) };
        if (loopState.timeoutId) clearTimeout(loopState.timeoutId);
        if (loopState.currentRunId) {
            try { await githubApi(`/actions/runs/${loopState.currentRunId}/cancel`, GITHUB_TOKEN, { method: 'POST' }); } catch (e) { /* Bỏ qua lỗi */ }
        }
        loopState = { isRunning: false, workflowId: null, currentRunId: null, timeoutId: null };
        return { statusCode: 200, body: JSON.stringify({ message: "Đã dừng vòng lặp." }) };
    }
    if (action === 'status') {
        return { statusCode: 200, body: JSON.stringify({ isRunning: loopState.isRunning, workflowId: loopState.workflowId }) };
    }
    return { statusCode: 400, body: JSON.stringify({ message: "Hành động không hợp lệ." }) };
};
