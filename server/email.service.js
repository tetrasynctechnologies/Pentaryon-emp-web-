const nodemailer = require('nodemailer');
const config = require('./config');

/**
 * HTML Escaping helper for email rendering
 */
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Priority badge styling helper
 */
function getPriorityBadge(priority) {
  const p = String(priority || 'medium').toLowerCase();
  switch (p) {
    case 'urgent':
      return { bg: '#450a0a', border: '#b91c1c', text: '#fca5a5', label: 'URGENT' };
    case 'high':
      return { bg: '#451a03', border: '#b45309', text: '#fde68a', label: 'HIGH' };
    case 'low':
      return { bg: '#0f172a', border: '#334155', text: '#94a3b8', label: 'LOW' };
    case 'medium':
    default:
      return { bg: '#082f49', border: '#0284c7', text: '#7dd3fc', label: 'MEDIUM' };
  }
}

/**
 * Create Gmail SMTP transporter
 */
let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  if (!config.gmailAppPassword) return null;

  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: config.gmailUser,
      pass: config.gmailAppPassword
    }
  });

  return transporter;
}

/**
 * Send an automated task assignment briefing email to an employee
 * @param {Object} params
 * @param {Object} params.task - The created task record
 * @param {Object} params.assignee - The assignee user record
 * @param {Object} params.creator - The assigning administrator user record
 * @returns {Promise<{success: boolean, skipped?: boolean, messageId?: string, error?: string}>}
 */
async function sendTaskAssignedEmail({ task, assignee, creator }) {
  const recipientEmail = assignee?.email?.trim();

  if (!recipientEmail) {
    console.log(`[Email Service] Assignee @${assignee?.username} has no email address configured. Skipping email.`);
    return { success: false, skipped: true, reason: 'NO_EMAIL' };
  }

  const client = getTransporter();
  if (!client) {
    console.log(`[Email Service] GMAIL_APP_PASSWORD is not configured in environment. Skipping email dispatch to ${recipientEmail} for task "${task?.title}".`);
    return { success: false, skipped: true, reason: 'NO_GMAIL_CREDENTIALS' };
  }

  const priorityStyle = getPriorityBadge(task.priority);
  const portalUrl = config.portalUrl || 'https://tetrasync.tech';
  const dueDateDisplay = task.due_date ? esc(task.due_date) : 'Flexible / Ongoing';
  const categoryDisplay = esc(task.category || assignee.department || 'General');
  const scopeHtml = esc(task.description || 'No detailed instructions provided.')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>');

  const subject = `[Pentaryon Task] ${priorityStyle.label}: ${task.title}`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#0b0f19;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#e2e8f0;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#0b0f19;padding:32px 16px;">
    <tr>
      <td align="center">
        <!-- Main Card -->
        <table role="presentation" width="100%" style="max-width:600px;background-color:#111827;border:1px solid #1f2937;border-radius:12px;overflow:hidden;box-shadow:0 10px 25px rgba(0,0,0,0.5);" cellspacing="0" cellpadding="0" border="0">
          
          <!-- Header -->
          <tr>
            <td style="padding:24px 32px;background:linear-gradient(135deg,#0e273c,#111827);border-bottom:1px solid #1f2937;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td>
                    <span style="font-size:18px;font-weight:700;letter-spacing:1px;color:#38bdf8;">PENTARYON</span>
                    <span style="font-size:12px;color:#94a3b8;margin-left:8px;letter-spacing:0.5px;">TECHNOLOGY</span>
                  </td>
                  <td align="right">
                    <span style="display:inline-block;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:0.5px;background-color:${priorityStyle.bg};border:1px solid ${priorityStyle.border};color:${priorityStyle.text};">
                      ${priorityStyle.label} PRIORITY
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td style="padding:32px;">
              <div style="font-size:13px;font-weight:600;color:#38bdf8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">New Work Assignment</div>
              <h1 style="font-size:22px;font-weight:700;color:#f8fafc;margin:0 0 16px 0;line-height:1.3;">
                ${esc(task.title)}
              </h1>

              <p style="font-size:14px;color:#94a3b8;line-height:1.6;margin:0 0 24px 0;">
                Hello <strong>${esc(assignee.name)}</strong> (@${esc(assignee.username)}), you have been assigned a new work package by <strong>${esc(creator.name || creator.username)}</strong>.
              </p>

              <!-- Meta Grid -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#1e293b;border-radius:8px;margin-bottom:24px;border:1px solid #334155;">
                <tr>
                  <td style="padding:14px 16px;border-bottom:1px solid #334155;width:50%;">
                    <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Category / Stream</div>
                    <div style="font-size:13px;font-weight:600;color:#e2e8f0;margin-top:2px;">${categoryDisplay}</div>
                  </td>
                  <td style="padding:14px 16px;border-bottom:1px solid #334155;width:50%;">
                    <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Target Due Date</div>
                    <div style="font-size:13px;font-weight:600;color:#e2e8f0;margin-top:2px;">${dueDateDisplay}</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:14px 16px;">
                    <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Delegating Executive</div>
                    <div style="font-size:13px;font-weight:600;color:#e2e8f0;margin-top:2px;">${esc(creator.name)}</div>
                  </td>
                  <td style="padding:14px 16px;">
                    <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Status</div>
                    <div style="font-size:13px;font-weight:600;color:#38bdf8;margin-top:2px;">Pending / In Queue</div>
                  </td>
                </tr>
              </table>

              <!-- Scope / Instructions -->
              <div style="margin-bottom:28px;">
                <div style="font-size:12px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Scope & Specifications:</div>
                <div style="background-color:#0f172a;border-left:3px solid #38bdf8;border-radius:4px;padding:16px;font-size:13px;line-height:1.7;color:#cbd5e1;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;">
                  ${scopeHtml}
                </div>
              </div>

              <!-- CTA Button -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:12px;">
                <tr>
                  <td align="center">
                    <a href="${portalUrl}" target="_blank" style="display:inline-block;background:linear-gradient(135deg,#0284c7,#0369a1);color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:6px;letter-spacing:0.3px;box-shadow:0 4px 14px rgba(2,132,199,0.35);">
                      Open Workplace Portal &rarr;
                    </a>
                  </td>
                </tr>
              </table>
              <div style="text-align:center;font-size:11px;color:#64748b;">
                Sign in with your employee credential to record milestones and update task progress.
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;background-color:#0f172a;border-top:1px solid #1f2937;font-size:11px;color:#64748b;line-height:1.5;">
              <div>This is an automated operational briefing dispatched from the Pentaryon Technology Workplace Assignment Gate.</div>
              <div style="margin-top:4px;">Official Dispatcher: <a href="mailto:${config.gmailUser}" style="color:#38bdf8;text-decoration:none;">${config.gmailUser}</a> &middot; &copy; 2026 Pentaryon Technology. Confidential.</div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  const text = `
PENTARYON TECHNOLOGY - NEW WORK ASSIGNMENT
-----------------------------------------------------------
Priority: ${priorityStyle.label}
Title: ${task.title}
Category: ${task.category || assignee.department || 'General'}
Target Due Date: ${dueDateDisplay}
Assigned By: ${creator.name} (@${creator.username})

Scope & Specifications:
${task.description}

Access Workplace Portal:
${portalUrl}

--
Official Dispatcher: ${config.gmailUser}
Confidential. © 2026 Pentaryon Technology.
  `.trim();

  try {
    const info = await Promise.race([
      client.sendMail({
        from: `"Pentaryon Technology" <${config.gmailUser}>`,
        to: recipientEmail,
        subject,
        text,
        html
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Email dispatch timed out after 8 seconds')), 8000))
    ]);

    console.log(`[Email Service] Task notification sent to ${recipientEmail} for task "${task.title}" (Message ID: ${info.messageId})`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[Email Service Error] Failed to send email to ${recipientEmail}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Send an automated task completion briefing email to executive leadership
 * @param {Object} params
 * @param {Object} params.task - The completed task record
 * @param {Object} params.assignee - The employee who completed the work
 * @param {Object} params.creator - The administrator who assigned the work
 * @param {string} params.milestoneNote - The final completion note submitted by the employee
 * @returns {Promise<{success: boolean, skipped?: boolean, messageId?: string, error?: string}>}
 */
async function sendTaskCompletedEmail({ task, assignee, creator, milestoneNote }) {
  const client = getTransporter();
  if (!client) {
    console.log(`[Email Service] GMAIL_APP_PASSWORD is not configured. Skipping completion email for task "${task?.title}".`);
    return { success: false, skipped: true, reason: 'NO_GMAIL_CREDENTIALS' };
  }

  // Option B: Dispatched to creator, CC'd to executive management
  const fallbackAdminEmail = config.admins[0]?.email || 'joshuaaarik@gmail.com';
  const toEmail = (creator?.email && creator.email.trim()) ? creator.email.trim() : fallbackAdminEmail;

  const allAdminEmails = config.admins.map((a) => a.email && a.email.trim()).filter(Boolean);
  const ccEmails = allAdminEmails.filter((e) => e.toLowerCase() !== toEmail.toLowerCase());

  const priorityStyle = getPriorityBadge(task.priority);
  const portalUrl = config.portalUrl || 'https://tetrasync.tech';
  const categoryDisplay = esc(task.category || assignee?.department || 'General');
  const completionDate = new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
  const noteHtml = esc(milestoneNote || 'Task marked 100% completed.')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>');

  const subject = `[Pentaryon Milestone] COMPLETED: ${task.title}`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#0b0f19;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#e2e8f0;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#0b0f19;padding:32px 16px;">
    <tr>
      <td align="center">
        <!-- Main Card -->
        <table role="presentation" width="100%" style="max-width:600px;background-color:#111827;border:1px solid #1f2937;border-radius:12px;overflow:hidden;box-shadow:0 10px 25px rgba(0,0,0,0.5);" cellspacing="0" cellpadding="0" border="0">
          
          <!-- Header -->
          <tr>
            <td style="padding:24px 32px;background:linear-gradient(135deg,#064e3b,#111827);border-bottom:1px solid #1f2937;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td>
                    <span style="font-size:18px;font-weight:700;letter-spacing:1px;color:#34d399;">PENTARYON</span>
                    <span style="font-size:12px;color:#94a3b8;margin-left:8px;letter-spacing:0.5px;">OPERATIONS</span>
                  </td>
                  <td align="right">
                    <span style="display:inline-block;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:0.5px;background-color:#064e3b;border:1px solid #059669;color:#6ee7b7;">
                      ✓ COMPLETED (100%)
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td style="padding:32px;">
              <div style="font-size:13px;font-weight:600;color:#10b981;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Deliverable Finalized</div>
              <h1 style="font-size:22px;font-weight:700;color:#f8fafc;margin:0 0 16px 0;line-height:1.3;">
                ${esc(task.title)}
              </h1>

              <p style="font-size:14px;color:#94a3b8;line-height:1.6;margin:0 0 24px 0;">
                Executive Briefing: <strong>${esc(assignee?.name || assignee?.username)}</strong> (@${esc(assignee?.username)}) has marked work package <strong>#${task.id}</strong> as <strong>100% Completed</strong>.
              </p>

              <!-- Meta Grid -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#1e293b;border-radius:8px;margin-bottom:24px;border:1px solid #334155;">
                <tr>
                  <td style="padding:14px 16px;border-bottom:1px solid #334155;width:50%;">
                    <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Completed By</div>
                    <div style="font-size:13px;font-weight:600;color:#e2e8f0;margin-top:2px;">${esc(assignee?.name)} (${esc(assignee?.department || 'Staff')})</div>
                  </td>
                  <td style="padding:14px 16px;border-bottom:1px solid #334155;width:50%;">
                    <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Completion Date</div>
                    <div style="font-size:13px;font-weight:600;color:#34d399;margin-top:2px;">${completionDate}</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:14px 16px;width:50%;">
                    <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Delegated By</div>
                    <div style="font-size:13px;font-weight:600;color:#e2e8f0;margin-top:2px;">${esc(creator?.name || 'Executive Admin')}</div>
                  </td>
                  <td style="padding:14px 16px;width:50%;">
                    <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Stream / Priority</div>
                    <div style="font-size:13px;font-weight:600;color:#e2e8f0;margin-top:2px;">${categoryDisplay} &middot; ${priorityStyle.label}</div>
                  </td>
                </tr>
              </table>

              <!-- Completion Notes -->
              <div style="margin-bottom:28px;">
                <div style="font-size:12px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Final Milestone Submission:</div>
                <div style="background-color:#0f172a;border-left:3px solid #10b981;border-radius:4px;padding:16px;font-size:13px;line-height:1.7;color:#cbd5e1;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;">
                  ${noteHtml}
                </div>
              </div>

              <!-- CTA Button -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:12px;">
                <tr>
                  <td align="center">
                    <a href="${portalUrl}" target="_blank" style="display:inline-block;background:linear-gradient(135deg,#059669,#047857);color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:6px;letter-spacing:0.3px;box-shadow:0 4px 14px rgba(5,150,105,0.35);">
                      Review Work Package in Portal &rarr;
                    </a>
                  </td>
                </tr>
              </table>
              <div style="text-align:center;font-size:11px;color:#64748b;">
                Sign in with Executive clearance to audit milestones, verify assets, or archive the assignment.
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;background-color:#0f172a;border-top:1px solid #1f2937;font-size:11px;color:#64748b;line-height:1.5;">
              <div>This is an automated operational briefing dispatched from the Pentaryon Technology Workplace Clearance Gate.</div>
              <div style="margin-top:4px;">Dispatched to: <strong>${toEmail}</strong>${ccEmails.length ? ` &middot; CC: ${ccEmails.join(', ')}` : ''}</div>
              <div style="margin-top:4px;">Official Dispatcher: <a href="mailto:${config.gmailUser}" style="color:#34d399;text-decoration:none;">${config.gmailUser}</a> &middot; &copy; 2026 Pentaryon Technology. Confidential.</div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  const text = `
PENTARYON TECHNOLOGY - WORK PACKAGE COMPLETED
-----------------------------------------------------------
Status: 100% COMPLETED
Title: ${task.title}
Completed By: ${assignee?.name} (@${assignee?.username}) - ${assignee?.department || 'Staff'}
Delegated By: ${creator?.name || 'Executive Admin'}
Category: ${categoryDisplay}
Date: ${completionDate}

Final Milestone Submission:
${milestoneNote || 'Task marked 100% completed.'}

Review in Portal:
${portalUrl}

--
Recipient: ${toEmail}
CC: ${ccEmails.join(', ')}
Official Dispatcher: ${config.gmailUser}
Confidential. © 2026 Pentaryon Technology.
  `.trim();

  try {
    const mailOptions = {
      from: `"Pentaryon Technology" <${config.gmailUser}>`,
      to: toEmail,
      subject,
      text,
      html
    };

    if (ccEmails.length > 0) {
      mailOptions.cc = ccEmails;
    }

    const info = await Promise.race([
      client.sendMail(mailOptions),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Completion email dispatch timed out after 8 seconds')), 8000))
    ]);

    console.log(`[Email Service] Task completion briefing dispatched for task "${task.title}" to ${toEmail} (CC: ${ccEmails.join(', ')}) (Message ID: ${info.messageId})`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[Email Service Error] Failed to send completion email to ${toEmail}:`, err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  sendTaskAssignedEmail,
  sendTaskCompletedEmail,
  getPriorityBadge
};
