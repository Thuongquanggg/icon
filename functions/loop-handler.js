// functions/loop-handler.js

// Cấu hình headers để cho phép Cross-Origin (CORS)
const corsHeaders = {
    'Access-Control-Allow-Origin': '*', // Cho phép bất kỳ nguồn nào
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

let loopState = { isRunning: false, workflowId: null, currentRunId: null, timeoutId: null };
const RUN_INTERVAL = 2 * 60 * 1000;

async function githubApi(endpoint, token, options = {}) {
    const API_URL = 'https://api.github.com/repos/Thuongquanggg/Test';
    const response = await fetch(`${API_URL}${endpoint}`, {
        headers: { 'Accept': 'application/vnd.github.v3+json', 'Authorization': `token ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
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

// Hàm executeLoopCycle bây giờ sẽ lưu lại token để dùng cho các lần lặp sau
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
                    // Dùng lại token đã lưu để dừng
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
    // Xử lý yêu cầu OPTIONS của CORS trước tiên
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: corsHeaders, body: '' };
    }

    // Lấy dữ liệu từ body, bao gồm cả token
    const { action, workflowId, token } = JSON.parse(event.body);

    if (action === 'start') {
        if (!token) {
            return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: "Yêu cầu thiếu token." }) };
        }
        if (loopState.isRunning) {
            return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: "Vòng lặp đã chạy rồi." }) };
        }
        loopState.isRunning = true;
        loopState.workflowId = workflowId;
        // Bắt đầu vòng lặp và truyền token vào
        executeLoopCycle(token);
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ message: `Đã bắt đầu vòng lặp.` }) };
    }

    if (action === 'stop') {
        // Không cần token để dừng, vì vòng lặp đã lưu token rồi
        if (!loopState.isRunning) {
            return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: "Vòng lặp chưa chạy." }) };
        }
        if (loopState.timeoutId) clearTimeout(loopState.timeoutId);
        // Đặt isRunning thành false để vòng lặp tự dừng ở lần kiểm tra tiếp theo
        loopState.isRunning = false; 
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ message: "Đã gửi lệnh dừng vòng lặp." }) };
    }

    if (action === 'status') {
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ isRunning: loopState.isRunning, workflowId: loopState.workflowId }) };
    }

    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: "Hành động không hợp lệ." }) };
};
