/**
 * TetraSync Technologies - Work Portal Automated Test Suite
 * End-to-end integration & security verification
 */

const http = require('node:http');
const app = require('../server/index');
const config = require('../server/config');
const { db } = require('../server/db');

let server;
let baseUrl;

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers
    };

    let postData = null;
    if (body) {
      postData = JSON.stringify(body);
      reqHeaders['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = http.request(
      url,
      {
        method,
        headers: reqHeaders
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => {
          rawData += chunk;
        });
        res.on('end', () => {
          let json = {};
          try {
            json = JSON.parse(rawData);
          } catch (_) {
            json = { text: rawData };
          }

          // Extract session cookie if set
          const setCookie = res.headers['set-cookie'];
          let cookieHeader = null;
          if (setCookie) {
            cookieHeader = setCookie.map((c) => c.split(';')[0]).join('; ');
          }

          resolve({
            status: res.statusCode,
            headers: res.headers,
            cookie: cookieHeader,
            data: json
          });
        });
      }
    );

    req.on('error', reject);
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function runTests() {
  console.log('\n=============================================================');
  console.log('   TETRASYNC WORK PORTAL - AUTOMATED VERIFICATION SUITE       ');
  console.log('=============================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition, message) {
    total++;
    if (condition) {
      console.log(`  [PASS] Test ${total}: ${message}`);
      passed++;
    } else {
      console.error(`  [FAIL] Test ${total}: ${message}`);
      process.exitCode = 1;
    }
  }

  // Start test server on random port
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      console.log(`Test runner bound to: ${baseUrl}\n`);
      resolve();
    });
  });

  try {
    // Test 1: Health check & Metadata
    const metaRes = await request('GET', '/api/meta');
    assert(metaRes.status === 200 && metaRes.data.company === 'TetraSync Technologies', 'Public metadata endpoint serves corporate config');

    // Test 2: Admin Authentication (Joshua)
    const adminLogin = await request('POST', '/api/auth/login', {
      username: 'joshua',
      password: config.adminDefaultPassword
    });
    assert(adminLogin.status === 200 && adminLogin.data.user.role === 'admin', 'Administrator "joshua" authenticates successfully');
    const adminCookie = adminLogin.cookie;
    const adminToken = adminLogin.data.token;

    // Test 3: Other Admins Verification (Kishore, Jason, Akshay)
    for (const adminUser of ['kishore', 'jason', 'akshay']) {
      const aRes = await request('POST', '/api/auth/login', {
        username: adminUser,
        password: config.adminDefaultPassword
      });
      assert(aRes.status === 200 && aRes.data.user.role === 'admin', `Administrator "${adminUser}" authenticates successfully`);
    }

    // Test 4: Foundational Employees Authentication (Prashetha, Chethana, Surya, Harish)
    for (const emp of ['prashetha', 'chethana', 'surya', 'harish']) {
      const eRes = await request('POST', '/api/auth/login', {
        username: emp,
        password: config.getEmployeeDefaultPassword(emp)
      });
      assert(eRes.status === 200 && eRes.data.user.role === 'employee', `Employee "${emp}" authenticates successfully with role/department`);
    }

    // Test 5: New Employee Registration Request
    const testUsername = `test_emp_${Date.now()}`;
    const regRes = await request('POST', '/api/auth/register', {
      name: 'Devon Vance',
      username: testUsername,
      department: 'Cyber Security',
      password: 'SecurePassword123!',
      notes: 'Hardware security specialist ID #8849'
    });
    assert(regRes.status === 201 && regRes.data.status === 'pending', 'New employee registration request submitted into pending status');

    // Test 6: Zero-Trust Clearance Gate - Pending User Cannot Log In
    const prematureLogin = await request('POST', '/api/auth/login', {
      username: testUsername,
      password: 'SecurePassword123!'
    });
    assert(
      prematureLogin.status === 403 && prematureLogin.data.status === 'pending',
      'Zero-Trust Gate strictly prevents login before administrator clearance'
    );

    // Test 7: Admin Fetches Pending Queue & Approves User
    const queueRes = await request('GET', '/api/admin/requests', null, { Cookie: adminCookie });
    const pendingItem = queueRes.data.requests?.find((r) => r.username === testUsername);
    assert(pendingItem !== undefined, 'Administrator sees pending registration request in approval queue');

    const approveRes = await request('POST', `/api/admin/requests/${pendingItem.id}/approve`, null, { Cookie: adminCookie });
    assert(approveRes.status === 200 && approveRes.data.success, 'Administrator successfully approves employee account request');

    // Test 8: Approved Employee Can Now Authenticate
    const postApproveLogin = await request('POST', '/api/auth/login', {
      username: testUsername,
      password: 'SecurePassword123!'
    });
    assert(postApproveLogin.status === 200 && postApproveLogin.data.user.username === testUsername, 'Newly cleared employee logs in successfully');
    const empCookie = postApproveLogin.cookie;
    const empId = postApproveLogin.data.user.id;

    // Test 9: Admin Assigns Work / Task to Employee
    const taskAssignRes = await request(
      'POST',
      '/api/tasks',
      {
        title: 'Firmware Signal Integrity Audit',
        description: 'Run oscilloscope frequency spectrum analysis on bus communication pins and record jitter tolerances.',
        priority: 'urgent',
        assigned_to: empId,
        due_date: '2026-10-28',
        category: 'Cyber Security'
      },
      { Cookie: adminCookie }
    );
    assert(taskAssignRes.status === 201 && taskAssignRes.data.task.id, 'Administrator assigns new work with urgent priority to employee');
    const taskId = taskAssignRes.data.task.id;

    // Test 10: Employee Views Assigned Tasks
    const empTasksRes = await request('GET', '/api/tasks', null, { Cookie: empCookie });
    const foundTask = empTasksRes.data.tasks?.find((t) => t.id === taskId);
    assert(foundTask !== undefined && foundTask.status === 'pending', 'Employee receives and views newly assigned task in personal dashboard');

    // Test 11: Employee Updates Work Progress & Posts Milestone Note
    const updateProgressRes = await request(
      'PATCH',
      `/api/tasks/${taskId}/progress`,
      {
        status: 'in_progress',
        progress_percent: 65,
        note: 'Completed spectrum analyzer capture. SPI bus clock jitter is well within 2.4ns tolerance limits.'
      },
      { Cookie: empCookie }
    );
    assert(updateProgressRes.status === 200 && updateProgressRes.data.task.progress_percent === 65, 'Employee updates work progress percentage to 65%');

    // Test 12: Verify Task Timeline & Audit Log History
    const taskHistoryRes = await request('GET', `/api/tasks/${taskId}`, null, { Cookie: empCookie });
    assert(
      taskHistoryRes.status === 200 && taskHistoryRes.data.updates?.length >= 2,
      'Task timeline retains full chronological milestone logs with author identity'
    );

    // Test 13: Complete Work Assignment
    const completeRes = await request(
      'PATCH',
      `/api/tasks/${taskId}/progress`,
      {
        status: 'completed',
        progress_percent: 100,
        note: 'Firmware verification signed off and uploaded to release registry.'
      },
      { Cookie: empCookie }
    );
    assert(completeRes.status === 200 && completeRes.data.task.status === 'completed', 'Employee successfully marks task complete at 100%');

    // Test 14: Registration Rejection Flow
    const spamUsername = `spam_user_${Date.now()}`;
    await request('POST', '/api/auth/register', {
      name: 'Unverified Entity',
      username: spamUsername,
      department: 'Operations',
      password: 'Pass123456!'
    });
    const queue2Res = await request('GET', '/api/admin/requests', null, { Cookie: adminCookie });
    const spamItem = queue2Res.data.requests?.find((r) => r.username === spamUsername);

    const rejectRes = await request(
      'POST',
      `/api/admin/requests/${spamItem.id}/reject`,
      { reason: 'Identity not confirmed with HR' },
      { Cookie: adminCookie }
    );
    assert(rejectRes.status === 200 && rejectRes.data.success, 'Administrator rejects unauthorized registration request with reason');

    const rejectedLogin = await request('POST', '/api/auth/login', {
      username: spamUsername,
      password: 'Pass123456!'
    });
    assert(
      rejectedLogin.status === 403 && rejectedLogin.data.status === 'rejected',
      'Rejected user receives rejection reason notice and is barred from login'
    );

    // Test 15: Session Logout Invalidation
    const logoutRes = await request('POST', '/api/auth/logout', null, { Cookie: empCookie });
    assert(logoutRes.status === 200, 'Employee successfully logs out');

    const meAfterLogout = await request('GET', '/api/auth/me', null, { Cookie: empCookie });
    assert(meAfterLogout.status === 401, 'Logged out session cookie is invalidated immediately');

    // Test 16: Admin Permanently Purges Rejected Request
    const deleteRequestRes = await request(
      'DELETE',
      `/api/admin/requests/${spamItem.id}`,
      null,
      { Cookie: adminCookie }
    );
    assert(deleteRequestRes.status === 200 && deleteRequestRes.data.success, 'Administrator permanently purges rejected account request');

    // Test 17: BOLA / IDOR Defense - Employee Horizontal Access Control
    const prashethaLogin = await request('POST', '/api/auth/login', {
      username: 'prashetha',
      password: config.getEmployeeDefaultPassword('prashetha')
    });
    const prashethaCookie = prashethaLogin.cookie;

    const suryaUser = db.prepare("SELECT id FROM users WHERE username = 'surya'").get();
    const prashethaUser = db.prepare("SELECT id FROM users WHERE username = 'prashetha'").get();

    // Admin creates task strictly for Surya
    const suryaTaskRes = await request(
      'POST',
      '/api/tasks',
      {
        title: 'Penetration Test Internal Network',
        description: 'Conduct port scanning and firewall rule audit across subnet 10.0.0.0/24.',
        priority: 'high',
        assigned_to: suryaUser.id,
        category: 'Cyber Security'
      },
      { Cookie: adminCookie }
    );
    const suryaTaskId = suryaTaskRes.data.task.id;

    // Prashetha attempts to read Surya's task
    const idorReadRes = await request('GET', `/api/tasks/${suryaTaskId}`, null, { Cookie: prashethaCookie });
    assert(idorReadRes.status === 403, 'BOLA/IDOR Defense: Employee cannot view peer tasks (HTTP 403)');

    // Prashetha attempts to tamper with Surya's task progress
    const idorWriteRes = await request(
      'PATCH',
      `/api/tasks/${suryaTaskId}/progress`,
      {
        status: 'completed',
        progress_percent: 100,
        note: 'Unauthorized status manipulation attempt.'
      },
      { Cookie: prashethaCookie }
    );
    assert(idorWriteRes.status === 403, 'BOLA/IDOR Defense: Employee cannot modify peer task status/progress (HTTP 403)');

    // Test 18: Privilege Escalation Prevention - Employee Accessing Admin Endpoints
    const empAdminRequests = await request('GET', '/api/admin/requests', null, { Cookie: prashethaCookie });
    assert(empAdminRequests.status === 403, 'Privilege Escalation Gate: Employee blocked from GET /api/admin/requests');

    const empCreateTask = await request(
      'POST',
      '/api/tasks',
      {
        title: 'Rogue Task Creation',
        description: 'Employee attempting admin assignment bypass.',
        assigned_to: prashethaUser.id
      },
      { Cookie: prashethaCookie }
    );
    assert(empCreateTask.status === 403, 'Privilege Escalation Gate: Employee blocked from POST /api/tasks');

    // Test 19: CSRF / Origin Guard Enforcement
    const csrfAttack = await request(
      'POST',
      '/api/tasks',
      {
        title: 'Cross-Site Injected Task',
        description: 'Injected via malicious third-party site.',
        assigned_to: prashethaUser.id
      },
      {
        Cookie: adminCookie,
        Origin: 'https://malicious-cross-origin-attack.io'
      }
    );
    assert(csrfAttack.status === 403, 'Origin Guard: Cross-origin mutative request blocked (HTTP 403)');

    // Test 20: Brute-Force Rate Limiting Defense (IP-level and Account-level)
    const attackerIp = '198.51.100.99';
    let rateLimited = false;
    for (let i = 0; i < 11; i++) {
      const bfRes = await request(
        'POST',
        '/api/auth/login',
        { username: 'brute_force_target_user', password: 'WrongPasswordAttempt!' },
        { 'x-forwarded-for': attackerIp }
      );
      if (bfRes.status === 429) {
        rateLimited = true;
        break;
      }
    }
    assert(rateLimited, 'Brute-Force Shield: Exceeding failed login limit triggers HTTP 429 Lockout');

    const { _resetRateLimits } = require('../server/security');
    _resetRateLimits();

    // Test 21: Input Validation & Boundary Enforcement
    const longPassword = 'A'.repeat(150);
    const oversizedPassRes = await request('POST', '/api/auth/login', {
      username: 'joshua',
      password: longPassword
    });
    assert(oversizedPassRes.status === 400, 'Input Bounds: Oversized password (>128 chars) rejected with HTTP 400');

    const badProgressRes = await request(
      'PATCH',
      `/api/tasks/${suryaTaskId}/progress`,
      {
        progress_percent: 150,
        note: 'Attempting invalid progress percentage'
      },
      { Cookie: adminCookie }
    );
    assert(badProgressRes.status === 400, 'Input Bounds: Out-of-range progress percent (>100) rejected with HTTP 400');

    // Test 22: Progress & Status Auto-Sync
    const autoSyncRes = await request(
      'PATCH',
      `/api/tasks/${suryaTaskId}/progress`,
      {
        progress_percent: 100,
        note: 'Completed all subnet auditing steps.'
      },
      { Cookie: adminCookie }
    );
    assert(
      autoSyncRes.status === 200 && autoSyncRes.data.task.status === 'completed',
      'Auto-Sync Engine: Setting progress to 100% automatically sets status to completed'
    );

    // Test 23: SQL Wildcard Escaping in Search
    const searchRes = await request('GET', '/api/tasks?search=%25', null, { Cookie: adminCookie });
    assert(searchRes.status === 200 && Array.isArray(searchRes.data.tasks), 'SQL Wildcard Escaping: Searching with % handled safely');

    // Test 24: CSP Security Headers Strictness
    const indexRes = await request('GET', '/');
    const cspHeader = indexRes.headers['content-security-policy'] || '';
    assert(
      cspHeader.includes("script-src 'self'") && !cspHeader.includes('unpkg.com'),
      'Strict CSP Headers: External script CDNs completely eliminated'
    );

    // Test 25: Session Garbage Collection
    const { cleanExpiredSessions } = require('../server/auth');
    const cleanedCount = cleanExpiredSessions();
    assert(typeof cleanedCount === 'number', 'Session Lifecycle: cleanExpiredSessions executes without error');

    // Test 26: Role Separation - Admin entering Employee Access is rejected
    const adminOnEmpTab = await request('POST', '/api/auth/login', {
      username: 'joshua',
      password: config.adminDefaultPassword,
      expected_role: 'employee'
    });
    assert(
      adminOnEmpTab.status === 403 &&
      adminOnEmpTab.data.error?.includes('Administrative accounts cannot authenticate under Employee Access'),
      'Role Separation: Administrator credentials barred from Employee Access tab (HTTP 403)'
    );

    // Test 27: Role Separation - Employee entering Executive Admin is rejected
    const empOnAdminTab = await request('POST', '/api/auth/login', {
      username: 'prashetha',
      password: config.getEmployeeDefaultPassword('prashetha'),
      expected_role: 'admin'
    });
    assert(
      empOnAdminTab.status === 403 &&
      empOnAdminTab.data.error?.includes('This account does not have Executive Administrator clearance'),
      'Role Separation: Employee credentials barred from Executive Admin tab (HTTP 403)'
    );

    // Test 39: Employee Deletion - Unauthorized employee attempt is blocked
    const unauthDeleteEmp = await request('DELETE', `/api/admin/employees/7`, null, { Cookie: prashethaCookie });
    assert(unauthDeleteEmp.status === 403, 'Privilege Escalation Gate: Employee cannot delete peers (HTTP 403)');

    // Test 40: Administrator directly creates and deletes an employee
    const adminCreateEmp = await request('POST', '/api/admin/employees', {
      name: 'Temporary Staff',
      username: 'temp.staff',
      password: 'password123',
      department: 'Operations'
    }, { Cookie: adminCookie });
    assert(adminCreateEmp.status === 201 && adminCreateEmp.data.success, 'Administrator directly creates new employee account');
    const tempStaffId = adminCreateEmp.data.employee.id;

    const adminDeleteEmp = await request('DELETE', `/api/admin/employees/${tempStaffId}`, null, { Cookie: adminCookie });
    assert(adminDeleteEmp.status === 200 && adminDeleteEmp.data.success, 'Administrator permanently deletes employee from directory');

    // Test 41: Safety Guard - Cannot delete admin account
    const deleteAdminAttempt = await request('DELETE', `/api/admin/employees/1`, null, { Cookie: adminCookie });
    assert(deleteAdminAttempt.status === 400 || deleteAdminAttempt.status === 403, 'Safety Guard: Admin accounts cannot be deleted via employee endpoint');

    // Test 42: Administrator updates assignment due date via progress modal
    const updateDueAdmin = await request('PATCH', `/api/tasks/${taskId}/progress`, {
      status: 'in_progress',
      progress_percent: 75,
      note: 'Executive milestone review completed.',
      due_date: '2026-11-15'
    }, { Cookie: adminCookie });
    assert(
      updateDueAdmin.status === 200 && updateDueAdmin.data.task.due_date === '2026-11-15',
      'Administrator updates assignment due date successfully'
    );

    // Test 43: Employee cannot update assignment due date
    const updateDueEmp = await request('PATCH', `/api/tasks/${taskId}/progress`, {
      status: 'in_progress',
      progress_percent: 80,
      note: 'Employee progress update.',
      due_date: '2026-12-01'
    }, { Cookie: prashethaCookie });
    assert(
      updateDueEmp.status === 403,
      'Safety Guard: Employee barred from changing assignment due date (HTTP 403)'
    );

    // Test 44: Administrator updates employee department / role with custom typed value
    const updateEmpDept = await request('PATCH', `/api/admin/employees/${suryaUser.id}`, {
      department: 'Avionics Flight Hardware'
    }, { Cookie: adminCookie });
    assert(
      updateEmpDept.status === 200 && updateEmpDept.data.success,
      'Administrator updates employee department with custom typed title'
    );

    // Reset Surya's department back to baseline
    await request('PATCH', `/api/admin/employees/${suryaUser.id}`, {
      department: 'Cyber Security'
    }, { Cookie: adminCookie });

    // Test 45: Cascade-Safe Employee Deletion with active tasks & updates
    const newEmpRes = await request('POST', '/api/admin/employees', {
      name: 'Temporary Deletion Test',
      username: 'temp_del_user',
      password: 'TempPassword123!',
      department: 'Systems Eng'
    }, { Cookie: adminCookie });
    const tempEmpId = newEmpRes.data.employee.id;

    const tempTaskRes = await request('POST', '/api/tasks', {
      title: 'Temporary Deletion Cascade Task',
      description: 'Verifying cascade safety on deletion of assigned employee.',
      priority: 'low',
      assigned_to: tempEmpId,
      category: 'Systems Eng'
    }, { Cookie: adminCookie });
    const tempTaskId = tempTaskRes.data.task.id;

    await request('PATCH', `/api/tasks/${tempTaskId}/progress`, {
      status: 'in_progress',
      progress_percent: 25,
      note: 'Preliminary update before user deletion.'
    }, { Cookie: adminCookie });

    const delEmpRes = await request('DELETE', `/api/admin/employees/${tempEmpId}`, null, { Cookie: adminCookie });
    assert(
      delEmpRes.status === 200 && delEmpRes.data.success,
      'Cascade Deletion Safety: Employee with tasks and updates deleted cleanly without foreign key failure'
    );

    // Test 47: Strict CORS Defense - Foreign origin cannot read authenticated responses
    const corsRes = await request('GET', '/api/tasks', null, {
      Cookie: adminCookie,
      Origin: 'https://evil-attacker.com'
    });
    const allowOrigin = corsRes.headers['access-control-allow-origin'];
    assert(
      allowOrigin !== 'https://evil-attacker.com',
      'Strict CORS Defense: Foreign origin cannot exfiltrate authenticated resources (Access-Control-Allow-Origin blocked)'
    );

    // Test 48: Sec-Fetch-Site Defense - Cross-site mutative requests are rejected
    const crossSiteRes = await request('POST', '/api/tasks', {
      title: 'Cross-Site Attempt',
      description: 'Should be blocked by Sec-Fetch-Site',
      priority: 'low',
      assigned_to: suryaUser.id
    }, {
      Cookie: adminCookie,
      'Sec-Fetch-Site': 'cross-site'
    });
    assert(
      crossSiteRes.status === 403 && crossSiteRes.data.error?.includes('Sec-Fetch-Site'),
      'Sec-Fetch-Site Guard: Cross-site mutative request blocked (HTTP 403)'
    );

    // Test 49: Distributed Brute-Force Shield - Account-level lockout across rotating proxy IPs
    const targetUser = `distrib_user_${Date.now()}`;
    await request('POST', '/api/auth/register', {
      name: 'Distributed Brute Target',
      username: targetUser,
      password: 'StrongPassword123!',
      department: 'Cyber Security'
    });
    let accountLocked = false;
    for (let i = 1; i <= 11; i++) {
      const spoofedIp = `192.0.2.${i}`;
      const res = await request('POST', '/api/auth/login', {
        username: targetUser,
        password: 'WrongPasswordGuess!'
      }, {
        'x-forwarded-for': spoofedIp
      });
      if (res.status === 429 && res.data.error?.includes('user account')) {
        accountLocked = true;
        break;
      }
    }
    assert(
      accountLocked,
      'Distributed Brute-Force Shield: Account-level lockout triggers HTTP 429 across rotating proxy IPs'
    );
    _resetRateLimits();

    // Test 50: Session Fixation Defense - Previous session revoked upon re-authentication
    const firstLogin = await request('POST', '/api/auth/login', {
      username: 'joshua',
      password: config.adminDefaultPassword
    });
    const firstToken = firstLogin.data.token;
    const secondLogin = await request('POST', '/api/auth/login', {
      username: 'joshua',
      password: config.adminDefaultPassword
    }, {
      Cookie: `session_id=${firstToken}`
    });
    const secondToken = secondLogin.data.token;
    assert(firstToken !== secondToken, 'Session Fixation Defense: New distinct token generated');
    const oldSessionLookup = db.prepare('SELECT id FROM sessions WHERE id = ?').get(firstToken);
    assert(!oldSessionLookup, 'Session Fixation Defense: Old session token revoked in SQLite upon login');

    // Test 51: Password Policy Floor - Passwords under 8 characters rejected
    const weakPassReg = await request('POST', '/api/auth/register', {
      name: 'Weak Password Applicant',
      username: `weak_pass_${Date.now()}`,
      password: 'Short7!',
      department: 'Cyber Security'
    });
    assert(
      weakPassReg.status === 400 && weakPassReg.data.error?.includes('8 and 128 characters'),
      'Password Policy Floor: Passwords under 8 characters rejected with HTTP 400'
    );

    // Test 52: Audit Log Sanitization - CRLF and terminal control sequences stripped
    const crlfName = 'Malicious\r\nActor\x1b[31m';
    const crlfDept = 'Department\r\nExploit';
    await request('POST', '/api/auth/register', {
      name: crlfName,
      username: `crlf_user_${Date.now()}`,
      password: 'ValidPassword123!',
      department: crlfDept
    });
    const loggedAudit = db.prepare('SELECT details FROM audit_logs WHERE details LIKE ? ORDER BY id DESC LIMIT 1').get('%crlf_user%');
    assert(
      loggedAudit && !loggedAudit.details.includes('\r') && !loggedAudit.details.includes('\n') && !loggedAudit.details.includes('\x1b'),
      'Audit Log Sanitization: CRLF and terminal control sequences stripped from audit trails'
    );

    // Test 53: Session Token Format Validation - Malformed non-hex tokens safely rejected
    const invalidTokenRes = await request('GET', '/api/auth/me', null, {
      Cookie: 'session_id=invalid_non_hex_token_attempt_123'
    });
    assert(
      invalidTokenRes.status === 401,
      'Session Token Format Validation: Non-hex session tokens rejected safely with HTTP 401'
    );

    console.log(`\nResults: ${passed} / ${total} tests passed successfully.\n`);
  } catch (err) {
    console.error('Test execution failed with error:', err);
    process.exitCode = 1;
  } finally {
    try {
      db.exec(`
        PRAGMA foreign_keys = OFF;
        DELETE FROM tasks;
        DELETE FROM task_updates;
        DELETE FROM audit_logs;
        DELETE FROM sessions;
        DELETE FROM users WHERE username NOT IN ('joshua', 'kishore', 'jason', 'akshay', 'prashetha', 'chethana', 'surya', 'harish');
        UPDATE users SET department = 'Cyber Security' WHERE username = 'surya';
        DELETE FROM sqlite_sequence WHERE name IN ('tasks', 'task_updates', 'audit_logs');
        PRAGMA foreign_keys = ON;
      `);
    } catch (_) {}
    if (server) {
      server.close();
    }
  }
}

runTests();
