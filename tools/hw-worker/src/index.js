// Rehearsal Online Homework Backend — Cloudflare Worker Router & Scheduled Cron.
// Zero external dependencies; pure Cloudflare Workers ESM (D1 + R2).

import { corsHeaders, errResponse, isDevMode, jsonResponse } from './util.js';
import {
  handleOAuthHandoffComplete,
  handleOAuthHandoffPoll,
  handleOAuthHandoffStart,
  handleStudentCodeLogin,
  handleStudentGoogleLogin,
  handleStudentLinkGoogle,
  handleStudentLogout,
  handleStudentMe,
  handleTeacherEmailStart,
  handleTeacherEmailVerify,
  handleTeacherGoogleAuth,
  handleTeacherLogout,
  handleTeacherLogoutAll,
  handleTeacherMe,
  requireStudent,
  requireTeacher,
} from './auth.js';
import {
  getServerCapabilities,
  handleAdminPoGrant,
  handleBillingCheckout,
  handleBillingPortal,
  handleStripeWebhook,
  handleRedeemBeta,
} from './billing.js';
import {
  handleAddStudents,
  handleCreateClass,
  handleDeleteClass,
  handleDeleteStudent,
  handleExportStudentData,
  handleListClasses,
  handleListStudents,
  handleListStudentCodes,
  handleOpenTestStudent,
  handleRegenerateClassCodes,
  handleRegenerateStudentCode,
  handleRevokeClassSessions,
  handleRevokeStudentSessions,
  handleUpdateClass,
  handleUpdateStudent,
} from './classes.js';
import {
  handleCreateAssignment,
  handleCreateAssignmentPreview,
  handleDeleteAssignment,
  handleDownloadAssignmentScore,
  handleDownloadPreviewScore,
  handleGetAssignment,
  handleGetPreviewAssignment,
  handleListClassAssignments,
  handleStudentGetAssignment,
  handleStudentListAssignments,
  handleUpdateAssignment,
  handleUploadAssignmentScore,
} from './assignments.js';
import {
  handleDeleteSubmission,
  handleDeleteSubmissionAudio,
  handleExportGradebookCsv,
  handleGetGradebook,
  handleGradeSubmission,
  handleListAssignmentSubmissions,
  handleStartAttempt,
  handleStreamSubmissionAudio,
  handleSubmitAttempt,
} from './submissions.js';
import { runDailyCleanup } from './cron.js';

function decodeSeg(seg) {
  try { return decodeURIComponent(seg); } catch { return seg; }
}

async function withTeacher(request, env, fn) {
  const auth = await requireTeacher(request, env);
  if (auth.error) return auth.error;
  return fn(auth);
}

async function withStudent(request, env, fn) {
  const auth = await requireStudent(request, env);
  if (auth.error) return auth.error;
  return fn(auth);
}

async function route(request, env) {
  const method = request.method.toUpperCase();
  const url = new URL(request.url);
  // Normalize trailing slash (except root '/')
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;

  // ---------- CORS preflight
  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }

  // ---------- Health & Privacy
  if (method === 'GET' && path === '/api/health') {
    const { googleSignInEnabled, billingEnabled } = getServerCapabilities(env);
    return jsonResponse({
      ok: true,
      service: 'rehearsal-hw',
      devMode: isDevMode(env),
      googleSignInEnabled,
      // the Web client ID is public (Google shows it to every browser); sending it here means it's set in one place
      googleClientId: googleSignInEnabled ? String(env.GOOGLE_CLIENT_ID).trim() : '',
      billingEnabled,
    }, 200, request, env);
  }

  if (method === 'GET' && path === '/privacy') {
    const target = String(env?.PRIVACY_URL || 'https://loganshippee.github.io/rehearsal/privacy.html').trim();
    return new Response(null, {
      status: 302,
      headers: {
        ...corsHeaders(request, env),
        Location: target,
        'Cache-Control': 'no-store',
      },
    });
  }

  // ---------- Teacher Auth
  if (method === 'POST' && path === '/api/auth/teacher/email/start') {
    return handleTeacherEmailStart(request, env);
  }
  if (method === 'POST' && path === '/api/auth/teacher/email/verify') {
    return handleTeacherEmailVerify(request, env);
  }
  if (method === 'POST' && path === '/api/auth/teacher/google') {
    return handleTeacherGoogleAuth(request, env);
  }
  if (method === 'POST' && path === '/api/auth/teacher/oauth/start') {
    return handleOAuthHandoffStart(request, env);
  }
  if (method === 'POST' && path === '/api/auth/teacher/oauth/complete') {
    return handleOAuthHandoffComplete(request, env);
  }
  if (method === 'POST' && path === '/api/auth/teacher/oauth/poll') {
    return handleOAuthHandoffPoll(request, env);
  }
  if (method === 'GET' && path === '/api/auth/teacher/me') {
    return withTeacher(request, env, auth => handleTeacherMe(request, env, auth));
  }
  if (method === 'POST' && path === '/api/auth/teacher/logout') {
    return withTeacher(request, env, auth => handleTeacherLogout(request, env, auth));
  }
  if (method === 'POST' && path === '/api/auth/teacher/logout-all') {
    return withTeacher(request, env, auth => handleTeacherLogoutAll(request, env, auth));
  }

  // ---------- Student Auth
  if (method === 'POST' && path === '/api/auth/student/code') {
    return handleStudentCodeLogin(request, env);
  }
  if (method === 'POST' && path === '/api/auth/student/google') {
    return handleStudentGoogleLogin(request, env);
  }
  if (method === 'POST' && path === '/api/auth/student/link-google') {
    return withStudent(request, env, auth => handleStudentLinkGoogle(request, env, auth));
  }
  if (method === 'GET' && path === '/api/auth/student/me') {
    return withStudent(request, env, auth => handleStudentMe(request, env, auth));
  }
  if (method === 'POST' && path === '/api/auth/student/logout') {
    return withStudent(request, env, auth => handleStudentLogout(request, env, auth));
  }

  // ---------- Billing & Admin PO Grants
  if (method === 'POST' && path === '/api/billing/checkout') {
    return withTeacher(request, env, auth => handleBillingCheckout(request, env, auth.teacher));
  }
  if (method === 'POST' && path === '/api/billing/portal') {
    return withTeacher(request, env, auth => handleBillingPortal(request, env, auth.teacher));
  }
  if (method === 'POST' && path === '/api/billing/webhook') {
    return handleStripeWebhook(request, env);
  }
  if (method === 'POST' && path === '/api/teacher/redeem-beta') {
    return withTeacher(request, env, auth => handleRedeemBeta(request, env, auth));
  }
  if (method === 'POST' && path === '/api/admin/po-grant') {
    return handleAdminPoGrant(request, env);
  }

  // ---------- Classes
  if (path === '/api/classes') {
    if (method === 'GET') return withTeacher(request, env, auth => handleListClasses(request, env, auth));
    if (method === 'POST') return withTeacher(request, env, auth => handleCreateClass(request, env, auth));
  }

  let m;

  // /api/classes/:classId
  if ((m = path.match(/^\/api\/classes\/([^/]+)$/))) {
    const classId = decodeSeg(m[1]);
    if (method === 'PATCH') return withTeacher(request, env, auth => handleUpdateClass(request, env, auth, classId));
    if (method === 'DELETE') return withTeacher(request, env, auth => handleDeleteClass(request, env, auth, classId));
  }

  // /api/classes/:classId/students
  if ((m = path.match(/^\/api\/classes\/([^/]+)\/students$/))) {
    const classId = decodeSeg(m[1]);
    if (method === 'GET') return withTeacher(request, env, auth => handleListStudents(request, env, auth, classId));
    if (method === 'POST') return withTeacher(request, env, auth => handleAddStudents(request, env, auth, classId));
  }

  // /api/classes/:classId/students/codes (teacher's "Show codes" toggle)
  if (method === 'GET' && (m = path.match(/^\/api\/classes\/([^/]+)\/students\/codes$/))) {
    const classId = decodeSeg(m[1]);
    return withTeacher(request, env, auth => handleListStudentCodes(request, env, auth, classId));
  }

  // /api/classes/:classId/test-student/open
  if (method === 'POST' && (m = path.match(/^\/api\/classes\/([^/]+)\/test-student\/open$/))) {
    const classId = decodeSeg(m[1]);
    return withTeacher(request, env, auth => handleOpenTestStudent(request, env, auth, classId));
  }

  // /api/classes/:classId/regenerate-codes (and /students/regenerate-codes alias)
  if (method === 'POST' && (m = path.match(/^\/api\/classes\/([^/]+)(?:\/students)?\/regenerate-codes$/))) {
    const classId = decodeSeg(m[1]);
    return withTeacher(request, env, auth => handleRegenerateClassCodes(request, env, auth, classId));
  }

  // /api/classes/:classId/revoke-sessions (and /students/revoke-sessions alias)
  if (method === 'POST' && (m = path.match(/^\/api\/classes\/([^/]+)(?:\/students)?\/revoke-sessions$/))) {
    const classId = decodeSeg(m[1]);
    return withTeacher(request, env, auth => handleRevokeClassSessions(request, env, auth, classId));
  }

  // /api/classes/:classId/students/:studentId
  if ((m = path.match(/^\/api\/classes\/([^/]+)\/students\/([^/]+)$/))) {
    const classId = decodeSeg(m[1]);
    const studentId = decodeSeg(m[2]);
    if (method === 'PATCH') return withTeacher(request, env, auth => handleUpdateStudent(request, env, auth, classId, studentId));
    if (method === 'DELETE') return withTeacher(request, env, auth => handleDeleteStudent(request, env, auth, classId, studentId));
  }

  // /api/classes/:classId/students/:studentId/regenerate-code
  if (method === 'POST' && (m = path.match(/^\/api\/classes\/([^/]+)\/students\/([^/]+)\/regenerate-code$/))) {
    const classId = decodeSeg(m[1]);
    const studentId = decodeSeg(m[2]);
    return withTeacher(request, env, auth => handleRegenerateStudentCode(request, env, auth, classId, studentId));
  }

  // /api/classes/:classId/students/:studentId/revoke-sessions
  if (method === 'POST' && (m = path.match(/^\/api\/classes\/([^/]+)\/students\/([^/]+)\/revoke-sessions$/))) {
    const classId = decodeSeg(m[1]);
    const studentId = decodeSeg(m[2]);
    return withTeacher(request, env, auth => handleRevokeStudentSessions(request, env, auth, classId, studentId));
  }

  // /api/classes/:classId/students/:studentId/export
  if (method === 'GET' && (m = path.match(/^\/api\/classes\/([^/]+)\/students\/([^/]+)\/export$/))) {
    const classId = decodeSeg(m[1]);
    const studentId = decodeSeg(m[2]);
    return withTeacher(request, env, auth => handleExportStudentData(request, env, auth, classId, studentId));
  }

  // /api/classes/:classId/assignments
  if ((m = path.match(/^\/api\/classes\/([^/]+)\/assignments$/))) {
    const classId = decodeSeg(m[1]);
    if (method === 'GET') return withTeacher(request, env, auth => handleListClassAssignments(request, env, auth, classId));
    if (method === 'POST') return withTeacher(request, env, auth => handleCreateAssignment(request, env, auth, classId));
  }

  // /api/classes/:classId/gradebook & /api/classes/:classId/gradebook.csv
  if (method === 'GET' && (m = path.match(/^\/api\/classes\/([^/]+)\/gradebook$/))) {
    const classId = decodeSeg(m[1]);
    return withTeacher(request, env, auth => handleGetGradebook(request, env, auth, classId));
  }
  if (method === 'GET' && (m = path.match(/^\/api\/classes\/([^/]+)\/gradebook\.csv$/))) {
    const classId = decodeSeg(m[1]);
    return withTeacher(request, env, auth => handleExportGradebookCsv(request, env, auth, classId));
  }

  // ---------- Teacher Assignments & Score Media
  if ((m = path.match(/^\/api\/assignments\/([^/]+)$/))) {
    const assignmentId = decodeSeg(m[1]);
    if (method === 'GET') return withTeacher(request, env, auth => handleGetAssignment(request, env, auth, assignmentId));
    if (method === 'PATCH') return withTeacher(request, env, auth => handleUpdateAssignment(request, env, auth, assignmentId));
    if (method === 'DELETE') return withTeacher(request, env, auth => handleDeleteAssignment(request, env, auth, assignmentId));
  }

  if ((m = path.match(/^\/api\/assignments\/([^/]+)\/score$/))) {
    const assignmentId = decodeSeg(m[1]);
    if (method === 'PUT' || method === 'POST') {
      return withTeacher(request, env, auth => handleUploadAssignmentScore(request, env, auth, assignmentId));
    }
    if (method === 'GET') {
      // Authorizes either owning teacher or enrolled student internally
      return handleDownloadAssignmentScore(request, env, assignmentId);
    }
  }

  if (method === 'GET' && (m = path.match(/^\/api\/assignments\/([^/]+)\/submissions$/))) {
    const assignmentId = decodeSeg(m[1]);
    return withTeacher(request, env, auth => handleListAssignmentSubmissions(request, env, auth, assignmentId));
  }

  if (method === 'POST' && (m = path.match(/^\/api\/assignments\/([^/]+)\/preview$/))) {
    const assignmentId = decodeSeg(m[1]);
    return withTeacher(request, env, auth => handleCreateAssignmentPreview(request, env, auth, assignmentId));
  }

  // ---------- Stateless Teacher Preview Sandbox
  if (method === 'GET' && path === '/api/preview/assignment') {
    return handleGetPreviewAssignment(request, env);
  }
  if (method === 'GET' && path === '/api/preview/score') {
    return handleDownloadPreviewScore(request, env);
  }

  // ---------- Student Portal, Attempt Starts & Submissions
  if (method === 'GET' && path === '/api/student/assignments') {
    return withStudent(request, env, auth => handleStudentListAssignments(request, env, auth));
  }

  if (method === 'GET' && (m = path.match(/^\/api\/student\/assignments\/([^/]+)$/))) {
    const assignmentId = decodeSeg(m[1]);
    return withStudent(request, env, auth => handleStudentGetAssignment(request, env, auth, assignmentId));
  }

  if (method === 'POST' && (m = path.match(/^\/api\/student\/assignments\/([^/]+)\/start$/))) {
    const assignmentId = decodeSeg(m[1]);
    return withStudent(request, env, auth => handleStartAttempt(request, env, auth, assignmentId));
  }

  if (method === 'POST' && (m = path.match(/^\/api\/student\/assignments\/([^/]+)\/submissions$/))) {
    const assignmentId = decodeSeg(m[1]);
    return withStudent(request, env, auth => handleSubmitAttempt(request, env, auth, assignmentId));
  }

  // ---------- Submission Audio & Teacher Grading
  if ((m = path.match(/^\/api\/submissions\/([^/]+)\/audio$/))) {
    const submissionId = decodeSeg(m[1]);
    if (method === 'GET') {
      // Authorizes either owning teacher or submitting student internally
      return handleStreamSubmissionAudio(request, env, submissionId);
    }
    if (method === 'DELETE') {
      return withTeacher(request, env, auth => handleDeleteSubmissionAudio(request, env, auth, submissionId));
    }
  }

  if ((m = path.match(/^\/api\/submissions\/([^/]+)$/))) {
    const submissionId = decodeSeg(m[1]);
    if (method === 'PATCH') return withTeacher(request, env, auth => handleGradeSubmission(request, env, auth, submissionId));
    if (method === 'DELETE') return withTeacher(request, env, auth => handleDeleteSubmission(request, env, auth, submissionId));
  }

  return errResponse('Not found', 404, 'NOT_FOUND', request, env);
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx);
    } catch (err) {
      if (typeof console !== 'undefined' && console.error) {
        console.error('[rehearsal-hw] unhandled error:', err?.stack || err);
      }
      return errResponse(
        'Something went wrong on the server. Please try again.',
        500,
        'INTERNAL_ERROR',
        request,
        env
      );
    }
  },

  async scheduled(event, env, ctx) {
    const job = runDailyCleanup(env).catch(err => {
      if (typeof console !== 'undefined' && console.error) {
        console.error('[rehearsal-hw] daily cleanup failed:', err?.stack || err);
      }
    });
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(job);
    } else {
      await job;
    }
  },
};
