import React, { useState, useEffect, useRef } from "react";
import {
  Plus, X, ExternalLink, Trash2, Download, Search, GripVertical,
  LayoutGrid, FolderOpen, Sparkles, FileText, Copy, Check, Link2, Loader2, Users, UserPlus, Upload, Eye, StickyNote,
  Bold, Italic, List, ListOrdered, Heading, Underline, LogOut,
} from "lucide-react";

// ============================ Config ========================================
const STAGES = [
  { id: "saved", label: "Saved", color: "#8a8577" },
  { id: "applied", label: "Applied", color: "#3a6ea5" },
  { id: "interview", label: "Interview", color: "#b8860b" },
  { id: "offer", label: "Offer", color: "#2f7d5b" },
];
const SPONSORSHIP = {
  confirmed: { label: "Sponsors", color: "#2f7d5b", bg: "#e6f0ea" },
  unknown: { label: "Unverified", color: "#b8860b", bg: "#f5edda" },
  no: { label: "No sponsorship", color: "#a85d5d", bg: "#f3e6e6" },
};
const PRIORITY = {
  dream: { label: "Dream role", color: "#b5612f", bg: "#f3e7dd" },
  high: { label: "High", color: "#2f7d5b", bg: "#e6f0ea" },
  medium: { label: "Medium", color: "#b8860b", bg: "#f5edda" },
  low: { label: "Low", color: "#46446a", bg: "rgba(120,108,255,.13)" },
};
const LEVEL = {
  internship: { label: "Internship" },
  newgrad: { label: "New grad" },
  entry: { label: "Entry · 0–2 yrs" },
  mid: { label: "Mid · 3–5 yrs" },
  senior: { label: "Senior · 6+ yrs" },
};
const CONTACT_TYPES = ["Referral", "Cold email", "Recruiter", "Hiring manager", "Networking", "Other"];
const APPS_KEY = "jah:applications";
const NOTES_KEY = "jah:notes";

const blankApp = () => ({
  id: crypto.randomUUID(), company: "", role: "", link: "", platform: "", stage: "saved",
  sponsorship: "unknown", priority: "high", level: "entry", workModel: "", location: "", comp: "", resumeVersion: "",
  dateApplied: "", followUp: "", nextStep: "",
  notes: "", contacts: [], jd: "", analysis: null, coverLetter: "", createdAt: Date.now(),
  resumeText: "", resumeId: null, resumeName: "",            // resume used for match analysis
  appliedResumeId: null, appliedResumeName: "",              // the actual resume submitted for this job
});

// ============================ Auth ==========================================
const AUTH_KEY = "jah:pw";
const getPw = () => { try { return localStorage.getItem(AUTH_KEY) || ""; } catch (e) { return ""; } };
const setPw = (pw) => { try { pw ? localStorage.setItem(AUTH_KEY, pw) : localStorage.removeItem(AUTH_KEY); } catch (e) {} };
const authHeader = () => { const pw = getPw(); return pw ? { "X-App-Password": pw } : {}; };
// true if our saved password works (or there's no password set)
async function checkAuth() {
  try {
    const res = await fetch(`${API_BASE}/api/login`, { headers: { ...authHeader() } });
    return res.status !== 401;
  } catch (e) { return true; }   // backend unreachable → don't lock out; data calls will show errors
}

// ============================ Persistence (backend SQLite) ==================
async function load(key, fallback) {
  try {
    const res = await fetch(`${API_BASE}/api/data/${encodeURIComponent(key)}`, { headers: { ...authHeader() } });
    if (!res.ok) return fallback;
    const data = await res.json();
    return data && data.value != null ? data.value : fallback;
  } catch (e) { return fallback; }
}
async function save(key, val) {
  try {
    await fetch(`${API_BASE}/api/data/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ value: val }),
    });
  } catch (e) {}
}

// ============================ Claude API ====================================
const API_BASE = import.meta.env.VITE_API_BASE ?? "";
async function callClaude(prompt, maxTokens = 1000) {
  const res = await fetch(`${API_BASE}/api/claude`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error("Request failed (" + res.status + ")");
  const data = await res.json();
  return data.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
}
function parseJSON(text) {
  const clean = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  return JSON.parse(clean);
}
// ---- Resume file storage (upload → store + extract text) ----
async function uploadResumeFile(file) {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${API_BASE}/api/files`, { method: "POST", body: fd, headers: { ...authHeader() } });
  if (!res.ok) {
    let msg = "Upload failed (" + res.status + ")";
    try { const j = await res.json(); if (j.detail) msg = j.detail; } catch (e) {}
    throw new Error(msg);
  }
  return res.json();
}
async function fetchFileText(id) {
  const res = await fetch(`${API_BASE}/api/files/${id}/text`, { headers: { ...authHeader() } });
  if (!res.ok) return "";
  const d = await res.json();
  return d.text || "";
}
// just pull the text out, don't store the file (JD Keywords tab is throwaway)
async function extractResumeText(file) {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${API_BASE}/api/extract`, { method: "POST", body: fd, headers: { ...authHeader() } });
  if (!res.ok) {
    let msg = "Upload failed (" + res.status + ")";
    try { const j = await res.json(); if (j.detail) msg = j.detail; } catch (e) {}
    throw new Error(msg);
  }
  const d = await res.json();
  return d.text || "";
}
async function analyzeJD(resume, jd) {
  const prompt = `You are an expert technical recruiter and ATS analyst. Compare the RESUME against the JOB DESCRIPTION.
Return ONLY valid JSON (no markdown, no backticks, no commentary) of exactly this shape:
{"keywords":[{"term":"string","importance":"high"|"medium","present":true|false}],"coverageScore":0,"missing":["term"],"tailoring":["suggestion"],"sponsorship":{"status":"offered"|"not_offered"|"not_mentioned","mentions":["string"]}}
Rules:
- 14-22 keywords: concrete skills, tools, methods, qualifications drawn from the JD. present=true only if the resume genuinely contains it or a clear synonym.
- coverageScore: integer 0-100, % of important JD keywords present, weighting "high" terms more.
- tailoring: 4-6 concrete, honest suggestions referencing real resume content. Only suggest adding terms the candidate can truthfully claim; if a real requirement is absent, name it as a gap rather than inventing experience.
- sponsorship: scan the JOB DESCRIPTION ONLY (not the resume) for ANYTHING related to visa, work authorization, sponsorship, citizenship, residency, eligibility to work, or security clearance.
- sponsorship.status: a quick signal only — "offered" if it indicates sponsorship is available; "not_offered" if it rules it out or requires existing authorization/citizenship/clearance; "not_mentioned" if the JD says nothing relevant.
- sponsorship.mentions: an array containing EVERY relevant statement quoted VERBATIM from the JD (each a separate string, exactly as written, no paraphrasing) — so the reader can judge for themselves. Include anything even tangentially related (e.g. "must be eligible to work in the US", "open to H-1B sponsorship", "US citizens or permanent residents", "active security clearance required"). Use an empty array [] only if the JD truly says nothing about it. Do NOT infer or invent — quote only what is literally present.

RESUME:
"""${resume}"""

JOB DESCRIPTION:
"""${jd}"""`;
  return parseJSON(await callClaude(prompt, 1000));
}
async function tailorResume(resume, jd, analysis) {
  const missing = (analysis && analysis.missing || []).join(", ");
  const prompt = `You are an expert resume writer and ATS specialist. Rewrite parts of the candidate's RESUME so it mirrors the JOB DESCRIPTION's language and passes ATS keyword screening — WITHOUT inventing any experience.
Return ONLY valid JSON (no markdown, no backticks, no commentary) of exactly this shape:
{"rewrites":[{"before":"a phrase or bullet copied verbatim from the resume","after":"the ATS-tailored rewrite","adds":["JD keyword woven in"]}],"skillsLine":"a single comma-separated skills line the candidate can truthfully add or merge into their Skills section","atsFixes":["concrete formatting/structure fix for ATS parsing"],"gaps":["a real JD requirement the resume genuinely lacks — name it honestly, never fabricate it"]}
Rules:
- 4-7 rewrites. "before" MUST be an exact phrase that appears in the resume. "after" rephrases the SAME accomplishment using the JD's terminology; never add achievements, metrics, tools, or responsibilities the resume doesn't already support.
- Only weave in keywords from MISSING_KEYWORDS that the candidate can truthfully claim given the existing bullet. If a missing keyword can't be claimed truthfully, list it under "gaps" instead.
- skillsLine: only skills already evidenced in the resume, as a plain comma-separated list. Use an empty string if nothing can be honestly added.
- atsFixes: 2-4 items — e.g. single-column layout, standard section headings, spell out then abbreviate ("Search Engine Optimization (SEO)"), avoid tables/graphics/headers-footers.
- gaps: real requirements the candidate cannot honestly claim from the resume. Empty array if none.

MISSING_KEYWORDS: ${missing || "(none flagged)"}

RESUME:
"""${resume}"""

JOB DESCRIPTION:
"""${jd}"""`;
  return parseJSON(await callClaude(prompt, 1500));
}
async function writeCoverLetter(resume, jd, company, role) {
  const prompt = `Write a professional cover letter for this candidate and role.
Format: greeting ("Dear Hiring Manager," if no name); 3-4 short paragraphs (hook + why this company/role; body matching the candidate's REAL experience to the JD's needs; brief close with a call to action); professional sign-off.
Constraints: ~280-340 words, specific, no clichés, never invent experience the resume lacks. Return ONLY the letter text.

CANDIDATE RESUME:
"""${resume}"""

COMPANY: ${company || "(unspecified)"}
ROLE: ${role || "(unspecified)"}

JOB DESCRIPTION:
"""${jd}"""`;
  return await callClaude(prompt, 1000);
}
async function extractKeywords(jd) {
  const prompt = `You are an expert technical recruiter. Read the JOB DESCRIPTION and extract the most important keywords a candidate should mirror in their resume and application. Do NOT reference any resume.
Return ONLY valid JSON (no markdown, no backticks, no commentary) of exactly this shape:
{"summary":"one or two plain sentences on what this role most wants","keywords":[{"term":"string","importance":"high"|"medium","category":"skill"|"tool"|"qualification"|"responsibility"}]}
Rules:
- 16-26 keywords. Prefer concrete skills, tools, technologies, methods, certifications and hard qualifications over vague soft phrases.
- importance "high" for terms that read as central/required; "medium" for nice-to-haves.
- category: "skill" (abilities/methods), "tool" (named technologies/software/languages/platforms), "qualification" (degrees, years of experience, certs, eligibility), "responsibility" (core duties).

JOB DESCRIPTION:
"""${jd}"""`;
  return parseJSON(await callClaude(prompt, 1000));
}

// ============================ Text helpers ==================================
const escHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const withProtocol = (u) => { const s = (u || "").trim(); return s && !/^https?:\/\//i.test(s) ? "https://" + s : s; };
// format a date (YYYY-MM-DD string or a timestamp) to e.g. "Jun 4, 2026"
const fmtDay = (v) => v ? (typeof v === "number" ? new Date(v) : new Date(String(v) + "T00:00:00")).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
// the date a role is grouped under: when it was applied, else when it was added
const rowDay = (a) => a.dateApplied ? fmtDay(a.dateApplied) : (a.createdAt ? fmtDay(a.createdAt) : "No date");
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function highlightJD(jd, keywords) {
  let html = escHtml(jd);
  if (!keywords || !keywords.length) return html.replace(/\n/g, "<br/>");
  const sorted = [...keywords].sort((a, b) => b.term.length - a.term.length);
  for (const k of sorted) {
    const re = new RegExp("(?<![A-Za-z0-9])(" + escRe(escHtml(k.term)) + ")(?![A-Za-z0-9])", "gi");
    const col = k.present ? "#2f7d5b" : "#b8860b";
    const bg = k.present ? "#e6f0ea" : "#f5edda";
    html = html.replace(re, (m) => `<mark style="background:${bg};color:${col};padding:1px 4px;border-radius:4px;font-weight:600">${m}</mark>`);
  }
  return html.replace(/\n/g, "<br/>");
}
function formatChecks(resume) {
  const t = resume || "";
  const words = t.split(/\s+/).filter(Boolean).length;
  return [
    { label: "Experience section present", ok: /experience|employment|work history/i.test(t) },
    { label: "Education section present", ok: /education|university|b\.?s\.?|m\.?s\.?/i.test(t) },
    { label: "Skills section present", ok: /skills|technologies|tech stack/i.test(t) },
    { label: "Contact info present", ok: /@|\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(t) },
    { label: "Substantial length (200+ words)", ok: words >= 200 },
    { label: "No column/tab layout detected", ok: !/\t.*\t/.test(t) },
  ];
}

// ============================ Styles ========================================
const css = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,500&family=Hanken+Grotesk:wght@400;500;600;700&display=swap');
.jt-root{--paper:#eef0fb;--card:rgba(255,255,255,.84);--card-solid:#ffffff;--ink:#0b0920;--muted:#383655;--line:rgba(122,116,178,.3);--accent:#5128ee;--accent-2:#2f6ff2;--accent-soft:rgba(120,108,255,.16);
  font-family:'Hanken Grotesk',sans-serif;color:var(--ink);min-height:100vh;
  background:linear-gradient(135deg,#e9e3ff 0%,#eef1fb 38%,#e1effb 70%,#efe9ff 100%) fixed}
.jt-root *,.jt-root *::before,.jt-root *::after{box-sizing:border-box}
/* frosted-glass surfaces */
.jt-card,.jt-stat,.jt-panel,.jt-board-card,.jt-list-row,.jt-nav,.jt-seg,.jt-status-chip,.jt-fselect,.jt-search input,.jt-field input,.jt-field select,.jt-field textarea,.jt-contact input,.jt-contact select,.jt-rt-toolbar,.jt-rt-body,.jt-link-item,.jt-score-wrap{-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
.jt-wrap{max-width:1240px;margin:0 auto;padding:28px 24px 64px}
.jt-head{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;flex-wrap:wrap;margin-bottom:22px}
.jt-title{font-family:'Fraunces',serif;font-weight:500;font-size:38px;line-height:1;letter-spacing:-.02em;margin:0}
.jt-title em{font-style:italic;color:var(--accent)}
.jt-sub{color:var(--muted);font-size:14px;margin-top:7px}
.jt-actions{display:flex;gap:10px}
.jt-btn{font-family:inherit;cursor:pointer;border:none;border-radius:10px;font-weight:600;font-size:14px;display:inline-flex;align-items:center;gap:7px;transition:transform .12s,box-shadow .12s,background .12s}
.jt-btn:active{transform:translateY(1px)}
.jt-btn[disabled]{opacity:.55;cursor:default}
.jt-primary{background:linear-gradient(135deg,var(--accent),var(--accent-2));color:#fff;padding:11px 18px;box-shadow:0 6px 18px rgba(109,94,252,.32)}
.jt-primary:hover:not([disabled]){box-shadow:0 8px 22px rgba(109,94,252,.42);filter:brightness(1.05)}
.jt-ghost{background:transparent;color:var(--muted);padding:9px 13px;border:1px solid var(--line)}
.jt-ghost:hover{color:var(--ink);border-color:var(--muted)}
.jt-nav{display:inline-flex;background:var(--card);border:1px solid var(--line);border-radius:11px;overflow:hidden;margin-bottom:24px}
.jt-nav button{font-family:inherit;border:none;background:transparent;cursor:pointer;padding:10px 16px;font-size:14px;font-weight:600;color:var(--muted);display:inline-flex;align-items:center;gap:7px}
.jt-nav button.on{background:var(--accent-soft);color:var(--accent)}
.jt-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:24px}
.jt-stat{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px}
.jt-stat-n{font-family:'Fraunces',serif;font-size:30px;font-weight:500;line-height:1}
.jt-stat-l{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.07em;margin-top:8px}
.jt-filters{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:22px}
.jt-search{flex:1;min-width:190px;position:relative}
.jt-search input{width:100%;font-family:inherit;font-size:14px;padding:10px 12px 10px 36px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--ink);outline:none}
.jt-search input:focus{border-color:var(--accent)}
.jt-search svg{position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--muted)}
.jt-seg{display:flex;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
.jt-seg button{font-family:inherit;border:none;background:transparent;cursor:pointer;padding:9px 12px;font-size:13px;font-weight:500;color:var(--muted)}
.jt-seg button.on{background:var(--accent-soft);color:var(--accent);font-weight:600}
.jt-fselect{font-family:inherit;font-size:13px;font-weight:500;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:10px;padding:9px 12px;cursor:pointer;outline:none}
.jt-fselect:focus{border-color:var(--accent)}
.jt-hint{font-size:11.5px;color:var(--muted);margin:-2px 0 7px;text-transform:none;letter-spacing:0;font-weight:400;line-height:1.35}
.jt-contact{display:grid;grid-template-columns:1.1fr .9fr 1.1fr auto;gap:8px;align-items:center;margin-bottom:8px}
.jt-contact input,.jt-contact select{font-family:inherit;font-size:13px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink);outline:none;width:100%}
.jt-contact input:focus,.jt-contact select:focus{border-color:var(--accent)}
@media(max-width:600px){.jt-contact{grid-template-columns:1fr 1fr}.jt-contact .jt-c-handle{grid-column:span 2}}
.jt-board{display:flex;gap:16px;overflow-x:auto;padding-bottom:12px}
.jt-col{flex:0 0 272px;min-width:272px}
.jt-col-head{display:flex;align-items:center;gap:8px;padding:0 4px 12px}
.jt-dot{width:9px;height:9px;border-radius:50%}
.jt-col-name{font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.06em}
.jt-col-count{color:var(--muted);font-size:13px;font-weight:500}
.jt-col-body{display:flex;flex-direction:column;gap:10px;min-height:80px;padding:8px;border-radius:14px;background:rgba(0,0,0,.015);border:1px dashed transparent;transition:border-color .12s,background .12s}
.jt-col-body.drop{border-color:var(--accent);background:var(--accent-soft)}
.jt-card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;box-shadow:0 2px 10px rgba(60,50,130,.06);cursor:grab;animation:jt-in .4s ease both;transition:box-shadow .14s,transform .14s}
.jt-card:hover{box-shadow:0 10px 26px rgba(80,64,170,.16);transform:translateY(-2px)}
.jt-card.dragging{opacity:.45}
.jt-card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
.jt-co{font-weight:700;font-size:15px;line-height:1.25}
.jt-role{color:var(--muted);font-size:13px;margin-top:1px}
.jt-grip{color:#a9a4c8;flex-shrink:0}
.jt-pills{display:flex;flex-wrap:wrap;gap:5px;margin-top:11px}
.jt-pill{font-size:11px;font-weight:600;padding:3px 8px;border-radius:20px}
.jt-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:11px;padding-top:10px;border-top:1px solid var(--line)}
.jt-meta-date{font-size:12px;color:var(--muted)}
.jt-card-actions{display:flex;gap:4px;align-items:center}
.jt-icon{background:transparent;border:none;cursor:pointer;color:var(--muted);padding:4px;border-radius:7px;display:inline-flex;transition:background .1s,color .1s}
.jt-icon:hover{background:var(--accent-soft);color:var(--accent)}
.jt-icon.danger:hover{background:#f3e6e6;color:#a85d5d}
.jt-empty{text-align:center;padding:46px 20px;color:var(--muted);font-size:13px}
.jt-statusbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px}
.jt-status-chip{font-family:inherit;cursor:pointer;border:1px solid var(--line);background:var(--card);border-radius:999px;padding:8px 14px;font-size:13px;font-weight:600;color:var(--muted);display:inline-flex;align-items:center;gap:7px;transition:background .12s,border-color .12s,color .12s}
.jt-status-chip:hover{border-color:var(--muted)}
.jt-status-chip.on{background:var(--accent-soft);border-color:var(--accent);color:var(--accent)}
.jt-status-chip .n{font-weight:500;opacity:.65}
.jt-list{display:flex;flex-direction:column;gap:8px}
.jt-date-head{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--accent);margin:18px 0 2px;padding-left:2px;display:flex;align-items:center;gap:8px}
.jt-date-head:first-child{margin-top:0}
.jt-date-head::after{content:"";flex:1;height:1px;background:var(--line)}
.jt-list-row{display:flex;align-items:center;gap:14px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:13px 16px;cursor:pointer;transition:box-shadow .14s,transform .14s}
.jt-list-row:hover{box-shadow:0 8px 22px rgba(80,64,170,.15);transform:translateY(-2px);border-color:rgba(109,94,252,.35)}
.jt-list-main{flex:1;min-width:0}
.jt-list-co{font-weight:700;font-size:15px}
.jt-list-role{color:var(--muted);font-size:13px;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.jt-list-pills{display:flex;gap:6px;flex-wrap:wrap;align-items:center;justify-content:flex-end}
.jt-list-actions{display:flex;gap:5px;align-items:center;flex-shrink:0}
@media(max-width:680px){.jt-list-row{flex-wrap:wrap}.jt-list-pills{order:3;width:100%;justify-content:flex-start;margin-top:4px}.jt-list-actions{order:2}}
@keyframes jt-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.jt-overlay{position:fixed;inset:0;background:rgba(40,34,80,.32);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);display:flex;align-items:flex-start;justify-content:center;padding:28px 16px;z-index:50;animation:jt-fade .2s ease;overflow-y:auto}
@keyframes jt-fade{from{opacity:0}to{opacity:1}}
.jt-modal{background:rgba(255,255,255,.86);-webkit-backdrop-filter:blur(24px);backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,.6);border-radius:20px;width:100%;max-width:780px;padding:24px;box-shadow:0 30px 70px rgba(50,40,110,.3);animation:jt-pop .25s cubic-bezier(.2,.9,.3,1.1) both}
.jt-modal.sm{max-width:520px}
@keyframes jt-pop{from{opacity:0;transform:translateY(14px) scale(.98)}to{opacity:1;transform:none}}
.jt-modal-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px}
.jt-modal-head h2{font-family:'Fraunces',serif;font-weight:500;font-size:23px;margin:0;line-height:1.15}
.jt-modal-head .jt-role{margin-top:2px}
.jt-tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin:14px 0 18px}
.jt-tabs button{font-family:inherit;border:none;background:transparent;cursor:pointer;padding:9px 14px;font-size:14px;font-weight:600;color:var(--muted);border-bottom:2px solid transparent;margin-bottom:-1px;display:inline-flex;align-items:center;gap:6px}
.jt-tabs button.on{color:var(--accent);border-bottom-color:var(--accent)}
.jt-field{margin-bottom:14px}
.jt-field label{display:block;font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}
.jt-field input,.jt-field select,.jt-field textarea{width:100%;font-family:inherit;font-size:14px;padding:10px 12px;border:1px solid var(--line);border-radius:9px;background:var(--card);color:var(--ink);outline:none}
.jt-field input:focus,.jt-field select:focus,.jt-field textarea:focus{border-color:var(--accent)}
.jt-field textarea{resize:vertical;min-height:64px;line-height:1.5}
.jt-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.jt-row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
.jt-foot{display:flex;justify-content:flex-end;gap:10px;margin-top:6px}
.jt-score-wrap{display:flex;gap:20px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:16px}
.jt-checks{list-style:none;padding:0;margin:0;display:grid;gap:6px;flex:1}
.jt-checks li{display:flex;align-items:center;gap:8px;font-size:13px}
.jt-chip{font-size:12px;font-weight:600;padding:4px 10px;border-radius:20px;display:inline-block;margin:0 6px 6px 0}
.jt-panel{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;margin-bottom:16px}
.jt-panel h4{font-family:'Fraunces',serif;font-weight:600;font-size:16px;margin:0 0 10px}
.jt-jd{font-size:13px;line-height:1.7;max-height:300px;overflow:auto;white-space:normal}
.jt-suggest{margin:0;padding-left:18px;font-size:14px;line-height:1.6}
.jt-suggest li{margin-bottom:7px}
.jt-rt-toolbar{display:flex;gap:3px;flex-wrap:wrap;border:1px solid var(--line);border-bottom:none;border-radius:9px 9px 0 0;padding:6px;background:var(--card)}
.jt-rt-toolbar button{font-family:inherit;min-width:32px;height:30px;border:1px solid transparent;background:transparent;border-radius:6px;cursor:pointer;color:var(--ink);display:inline-flex;align-items:center;justify-content:center;padding:0 7px;font-size:13px}
.jt-rt-toolbar button:hover{background:var(--accent-soft);color:var(--accent)}
.jt-rt-toolbar .sep{width:1px;background:var(--line);margin:3px 3px}
.jt-rt-body{min-height:200px;max-height:46vh;overflow:auto;border:1px solid var(--line);border-radius:0 0 9px 9px;background:var(--card);color:var(--ink);padding:12px 14px;font-size:14px;line-height:1.6;outline:none}
.jt-rt-body:focus{border-color:var(--accent)}
.jt-rt-body:empty:before{content:attr(data-placeholder);color:var(--muted)}
.jt-rt-body h2{font-family:'Fraunces',serif;font-weight:600;font-size:20px;margin:10px 0 4px}
.jt-rt-body h3{font-family:'Fraunces',serif;font-weight:600;font-size:16px;margin:8px 0 4px}
.jt-rt-body ul,.jt-rt-body ol{margin:6px 0;padding-left:22px}
.jt-rt-body li{margin:3px 0}
.jt-rt-body p{margin:6px 0}
.jt-rt-body a{color:var(--accent)}
.jt-spin{animation:jt-rot 1s linear infinite}
@keyframes jt-rot{to{transform:rotate(360deg)}}
.jt-link-item{display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--card);border:1px solid var(--line);border-radius:10px;margin-bottom:8px}
.jt-link-item a{color:var(--accent);text-decoration:none;font-weight:600;font-size:14px;flex:1;word-break:break-all}
.jt-note{font-size:12.5px;color:var(--muted);background:var(--accent-soft);border-radius:10px;padding:10px 13px;line-height:1.5}
.jt-boards{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:14px;margin-bottom:24px}
.jt-board-card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px;cursor:pointer;transition:box-shadow .14s,transform .14s,border-color .12s,background .12s}
.jt-board-card:hover{box-shadow:0 8px 22px rgba(80,64,170,.15);transform:translateY(-2px)}
.jt-board-card.on{border-color:var(--accent);background:var(--accent-soft)}
.jt-board-n{font-family:'Fraunces',serif;font-size:30px;font-weight:500;line-height:1}
.jt-board-card.on .jt-board-n{color:var(--accent)}
.jt-board-l{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.06em;margin-top:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media(max-width:720px){.jt-stats{grid-template-columns:repeat(2,1fr)}.jt-title{font-size:30px}.jt-row,.jt-row3{grid-template-columns:1fr}.jt-score-wrap{flex-direction:column;align-items:flex-start}}
`;

// ============================ Login =========================================
function LoginScreen({ onAuthed }) {
  const [pw, setPwInput] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!pw.trim() || busy) return;
    setErr(""); setBusy(true);
    setPw(pw);   // store so authHeader() picks it up
    try {
      const res = await fetch(`${API_BASE}/api/login`, { headers: { ...authHeader() } });
      if (res.ok) { onAuthed(); return; }
      setErr("Incorrect password."); setPw("");
    } catch (e2) { setErr("Couldn't reach the server — is the backend running?"); }
    setBusy(false);
  };
  return (
    <div className="jt-root">
      <style>{css}</style>
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <form onSubmit={submit} className="jt-modal sm" style={{ maxWidth: 380, margin: 0 }}>
          <h1 className="jt-title" style={{ fontSize: 30, marginBottom: 4 }}>Application <em>Hub</em></h1>
          <p className="jt-sub" style={{ marginTop: 0, marginBottom: 18 }}>Enter the password to continue.</p>
          <div className="jt-field">
            <label>Password</label>
            <input type="password" autoFocus value={pw} onChange={(e) => setPwInput(e.target.value)} placeholder="••••••••" />
          </div>
          {err && <div className="jt-note" style={{ background: "#fbe4ee", color: "#b32d68", marginBottom: 12 }}>{err}</div>}
          <button type="submit" className="jt-btn jt-primary" style={{ width: "100%", justifyContent: "center" }} disabled={busy}>
            {busy ? <><Loader2 size={15} className="jt-spin" /> Checking…</> : "Unlock"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ============================ App ===========================================
export default function App() {
  const [apps, setApps] = useState([]);
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("board");
  const [openId, setOpenId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [levelF, setLevelF] = useState("all");
  const [sponsorF, setSponsorF] = useState("all");
  const [statusF, setStatusF] = useState("all");
  const [platformF, setPlatformF] = useState("all");
  const [sortBy, setSortBy] = useState("newest");
  const [dragId, setDragId] = useState(null);
  const [dropCol, setDropCol] = useState(null);
  const [reBusy, setReBusy] = useState(false);
  const [reProg, setReProg] = useState({ done: 0, total: 0 });
  const [reMsg, setReMsg] = useState(null);   // { ok: bool, text }
  const [auth, setAuth] = useState("checking");   // "checking" | "needed" | "ok"

  const loadData = () => Promise.all([load(APPS_KEY, []), load(NOTES_KEY, [])])
    .then(([a, n]) => { setApps(a); setNotes(n); setLoading(false); });

  useEffect(() => {
    checkAuth().then((ok) => {
      if (!ok) { setAuth("needed"); return; }
      setAuth("ok"); loadData();
    });
  }, []);

  const persistApps = (next) => { setApps(next); save(APPS_KEY, next); };
  const persistNotes = (next) => { setNotes(next); save(NOTES_KEY, next); };
  const updateApp = (app) => persistApps(apps.some((a) => a.id === app.id) ? apps.map((a) => (a.id === app.id ? app : a)) : [...apps, app]);
  const removeApp = (id) => persistApps(apps.filter((a) => a.id !== id));
  const moveTo = (id, stage) => persistApps(apps.map((a) => (a.id === id ? { ...a, stage } : a)));

  const logout = () => { setPw(""); setAuth("needed"); };

  const exportXlsx = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/export.xlsx`, { headers: { ...authHeader() } });
      if (!res.ok) throw new Error("Export failed (" + res.status + ")");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url; a.download = "job-applications.xlsx"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { alert(e.message); }
  };

  // re-score every role that has both a resume and a JD
  const reanalyzeAll = async () => {
    const targets = apps.filter((a) => a.jd && a.jd.trim() && a.resumeText && a.resumeText.trim());
    if (targets.length === 0) { setReMsg({ ok: false, text: "No roles have both a resume and a job description yet." }); return; }
    if (targets.length > 10 && !window.confirm(`Re-analyze ${targets.length} roles? This runs one AI call per role (~1–2¢ each) and may take a moment.`)) return;
    setReMsg(null); setReBusy(true); setReProg({ done: 0, total: targets.length });
    let next = apps, failed = 0;
    for (let i = 0; i < targets.length; i++) {
      try {
        const analysis = await analyzeJD(targets[i].resumeText, targets[i].jd);
        next = next.map((x) => (x.id === targets[i].id ? { ...x, analysis, tailored: null } : x));
        setApps(next);   // live update so cards refresh as we go
      } catch (e) { failed++; }
      setReProg({ done: i + 1, total: targets.length });
    }
    save(APPS_KEY, next);
    setReBusy(false);
    setReMsg({ ok: failed === 0, text: failed === 0 ? `Updated ${targets.length} role${targets.length > 1 ? "s" : ""}, each with its own resume.` : `Updated ${targets.length - failed} of ${targets.length}; ${failed} failed — try again.` });
  };

  const matchesCore = (a) => {
    if (levelF !== "all" && a.level !== levelF) return false;
    if (sponsorF !== "all" && a.sponsorship !== sponsorF) return false;
    if (query && !(a.company + " " + a.role).toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  };
  const matchesPlatform = (a) => {
    if (platformF === "all") return true;
    return (a.platform && a.platform.trim() ? a.platform.trim() : "__none__") === platformF;
  };
  // Platform cards: core filters + status applied, platform ignored
  const platformBase = apps.filter((a) => matchesCore(a) && (statusF === "all" || a.stage === statusF));
  const pmap = {};
  platformBase.forEach((a) => { const k = a.platform && a.platform.trim() ? a.platform.trim() : "__none__"; pmap[k] = (pmap[k] || 0) + 1; });
  const platformList = Object.entries(pmap).map(([key, count]) => ({ key, label: key === "__none__" ? "Direct / other" : key, count })).sort((x, y) => y.count - x.count);
  // Status chips: core + platform applied, status ignored
  const statusBase = apps.filter((a) => matchesCore(a) && matchesPlatform(a));
  const stageCount = (id) => statusBase.filter((a) => a.stage === id).length;
  // Final visible list, sorted by date
  const dateTs = (a) => (a.dateApplied ? new Date(a.dateApplied).getTime() : (a.createdAt || 0));
  const visible = apps
    .filter((a) => matchesCore(a) && matchesPlatform(a) && (statusF === "all" || a.stage === statusF))
    .sort((a, b) => sortBy === "oldest" ? dateTs(a) - dateTs(b) : dateTs(b) - dateTs(a));
  const openApp = apps.find((a) => a.id === openId);

  if (auth === "checking") return <div className="jt-root"><style>{css}</style><div className="jt-wrap"><div className="jt-empty">Loading…</div></div></div>;
  if (auth === "needed") return <LoginScreen onAuthed={() => { setAuth("ok"); loadData(); }} />;

  return (
    <div className="jt-root">
      <style>{css}</style>
      <div className="jt-wrap">
        <header className="jt-head">
          <div>
            <h1 className="jt-title">Application <em>Hub</em></h1>
            <p className="jt-sub">Track, tailor, and write — sponsorship and leveling built in.</p>
          </div>
          <div className="jt-actions">
            {getPw() && <button className="jt-btn jt-ghost" onClick={logout} title="Lock — clears the password on this device"><LogOut size={15} /> Lock</button>}
            <button className="jt-btn jt-ghost" onClick={exportXlsx}><Download size={15} /> Export Excel</button>
            <button className="jt-btn jt-primary" onClick={() => setAdding(true)}><Plus size={16} /> Add role</button>
          </div>
        </header>

        <div className="jt-nav">
          <button className={view === "board" ? "on" : ""} onClick={() => setView("board")}><LayoutGrid size={16} /> Applications</button>
          <button className={view === "keywords" ? "on" : ""} onClick={() => setView("keywords")}><Search size={16} /> JD Keywords</button>
          <button className={view === "notes" ? "on" : ""} onClick={() => setView("notes")}><StickyNote size={16} /> Notes</button>
        </div>

        {view === "board" && (
          <>
            <section className="jt-boards">
              <div className={"jt-board-card" + (platformF === "all" ? " on" : "")} onClick={() => setPlatformF("all")}>
                <div className="jt-board-n">{platformBase.length}</div>
                <div className="jt-board-l">All sources</div>
              </div>
              {platformList.map((p) => (
                <div key={p.key} className={"jt-board-card" + (platformF === p.key ? " on" : "")} onClick={() => setPlatformF(platformF === p.key ? "all" : p.key)}>
                  <div className="jt-board-n">{p.count}</div>
                  <div className="jt-board-l">{p.label}</div>
                </div>
              ))}
            </section>
            <div className="jt-filters">
              <div className="jt-search"><Search size={15} />
                <input placeholder="Search company or role…" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <FilterSelect value={levelF} onChange={setLevelF} options={[["all", "All levels"], ["internship", "Internship"], ["newgrad", "New grad"], ["entry", "Entry-level"], ["mid", "Mid-level"], ["senior", "Senior"]]} />
              <FilterSelect value={sponsorF} onChange={setSponsorF} options={[["all", "Any sponsorship"], ["confirmed", "Sponsors"], ["unknown", "Unverified"], ["no", "No sponsorship"]]} />
              <FilterSelect value={sortBy} onChange={setSortBy} options={[["newest", "Newest first"], ["oldest", "Oldest first"]]} />
              <button className="jt-btn jt-ghost" onClick={reanalyzeAll} disabled={reBusy} style={{ marginLeft: "auto" }}
                title="Re-run the match score for every role using each role's own resume">
                {reBusy ? <><Loader2 size={15} className="jt-spin" /> Re-analyzing {reProg.done}/{reProg.total}…</> : <><Sparkles size={15} /> Re-analyze all</>}
              </button>
            </div>
            {reMsg && <div className="jt-note" style={{ marginBottom: 14, background: reMsg.ok ? "var(--accent-soft)" : "#f3e6e6", color: reMsg.ok ? "var(--accent)" : "#a85d5d" }}>{reMsg.text}</div>}
            <div className="jt-statusbar">
              <button className={"jt-status-chip" + (statusF === "all" ? " on" : "")} onClick={() => setStatusF("all")}>All <span className="n">{statusBase.length}</span></button>
              {STAGES.map((s) => (
                <button key={s.id} className={"jt-status-chip" + (statusF === s.id ? " on" : "")} onClick={() => setStatusF(s.id)}>
                  <span className="jt-dot" style={{ background: s.color }} /> {s.label} <span className="n">{stageCount(s.id)}</span>
                </button>
              ))}
            </div>
            {loading ? <div className="jt-empty">Loading…</div>
              : apps.length === 0 ? <div className="jt-empty">No roles yet. Hit <strong>Add role</strong> to start.</div>
              : visible.length === 0 ? <div className="jt-empty">No roles match these filters.</div>
              : (
                <div className="jt-list">
                  {visible.map((a, i) => {
                    const label = rowDay(a);
                    const showHead = i === 0 || rowDay(visible[i - 1]) !== label;
                    return (
                      <React.Fragment key={a.id}>
                        {showHead && <div className="jt-date-head">{label}</div>}
                        <ListRow app={a} onOpen={() => setOpenId(a.id)} onDelete={() => removeApp(a.id)} onMove={(s) => moveTo(a.id, s)} />
                      </React.Fragment>
                    );
                  })}
                </div>
              )}
          </>
        )}
        {view === "keywords" && <KeywordsView />}
        {view === "notes" && <NotesView notes={notes} onChange={persistNotes} />}
      </div>

      {adding && <AddModal onSave={(a) => { updateApp(a); setAdding(false); }} onClose={() => setAdding(false)} />}
      {openApp && <Workspace app={openApp} docLinks={[]} onUpdate={updateApp}
        onClose={() => setOpenId(null)} />}
    </div>
  );
}

// ============================ Small components ==============================
function Stat({ n, l, accent }) {
  return <div className="jt-stat"><div className="jt-stat-n" style={accent ? { color: "var(--accent)" } : {}}>{n}</div><div className="jt-stat-l">{l}</div></div>;
}
function Seg({ value, onChange, options }) {
  return <div className="jt-seg">{options.map(([v, l]) => <button key={v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>{l}</button>)}</div>;
}
function FilterSelect({ value, onChange, options }) {
  return <select className="jt-fselect" value={value} onChange={(e) => onChange(e.target.value)}>
    {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
  </select>;
}
const PLATFORMS = ["LinkedIn", "Indeed", "Handshake", "Wellfound", "Glassdoor", "ZipRecruiter", "Company website", "Referral"];
function PlatformInput({ value, onChange }) {
  return (
    <>
      <input list="jt-platforms" value={value} onChange={onChange} placeholder="e.g. Handshake, LinkedIn, referral…" />
      <datalist id="jt-platforms">{PLATFORMS.map((p) => <option key={p} value={p} />)}</datalist>
    </>
  );
}
function Ring({ value }) {
  const r = 34, c = 2 * Math.PI * r, off = c * (1 - value / 100);
  const color = value >= 70 ? "#2f7d5b" : value >= 45 ? "#b8860b" : "#a85d5d";
  return (
    <svg width="92" height="92" viewBox="0 0 92 92" style={{ flexShrink: 0 }}>
      <circle cx="46" cy="46" r={r} fill="none" stroke="#e3ddcf" strokeWidth="9" />
      <circle cx="46" cy="46" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 46 46)" style={{ transition: "stroke-dashoffset .6s ease" }} />
      <text x="46" y="51" textAnchor="middle" fontFamily="Fraunces,serif" fontSize="21" fontWeight="600" fill={color}>{value}%</text>
    </svg>
  );
}

function Card({ app, onOpen, onDelete, onMove, dragging, onDragStart, onDragEnd }) {
  const sp = SPONSORSHIP[app.sponsorship], lv = LEVEL[app.level] || LEVEL.entry;
  return (
    <div className={"jt-card" + (dragging ? " dragging" : "")} draggable onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="jt-card-top">
        <div onClick={onOpen} style={{ cursor: "pointer", flex: 1 }}>
          <div className="jt-co">{app.company || "Untitled"}</div>
          {app.role && <div className="jt-role">{app.role}</div>}
        </div>
        <GripVertical size={15} className="jt-grip" />
      </div>
      <div className="jt-pills">
        <span className="jt-pill" style={{ background: sp.bg, color: sp.color }}>{sp.label}</span>
        <span className="jt-pill" style={{ background: "rgba(120,108,255,.13)", color: "#3a3858" }}>{lv.label}</span>
        {app.workModel && <span className="jt-pill" style={{ background: "rgba(120,108,255,.13)", color: "#3a3858" }}>{app.workModel}</span>}
        {app.analysis && <span className="jt-pill" style={{ background: "#e7efe9", color: "#2f5d4f" }}>Match {app.analysis.coverageScore}%</span>}
        {app.coverLetter && <span className="jt-pill" style={{ background: "#eef0f5", color: "#3a6ea5" }}>CL ✓</span>}
      </div>
      <div className="jt-meta">
        <span className="jt-meta-date" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{app.dateApplied || "—"}{app.platform ? ` · ${app.platform}` : ""}{app.contacts && app.contacts.length > 0 && <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Users size={12} />{app.contacts.length}</span>}</span>
        <div className="jt-card-actions">
          {app.link && <a className="jt-icon" href={app.link} target="_blank" rel="noreferrer"><ExternalLink size={15} /></a>}
          <select value={app.stage} onChange={(e) => onMove(e.target.value)} title="Move stage"
            style={{ appearance: "none", fontFamily: "inherit", fontSize: 11, padding: "4px 6px", border: "1px solid var(--line)", borderRadius: 7, color: "var(--muted)", background: "var(--card)", cursor: "pointer" }}>
            {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <button className="jt-icon danger" onClick={onDelete}><Trash2 size={15} /></button>
        </div>
      </div>
    </div>
  );
}

// ============================ Add modal =====================================
function ListRow({ app, onOpen, onDelete, onMove }) {
  const sp = SPONSORSHIP[app.sponsorship], lv = LEVEL[app.level] || LEVEL.entry;
  const stage = STAGES.find((s) => s.id === app.stage) || STAGES[0];
  const subline = [app.role, app.platform].filter(Boolean).join(" · ");
  return (
    <div className="jt-list-row" onClick={onOpen}>
      <span className="jt-dot" style={{ background: stage.color, flexShrink: 0 }} title={stage.label} />
      <div className="jt-list-main">
        <div className="jt-list-co">{app.company || "Untitled"}</div>
        {subline && <div className="jt-list-role">{subline}</div>}
      </div>
      <div className="jt-list-pills">
        <span className="jt-pill" style={{ background: sp.bg, color: sp.color }}>{sp.label}</span>
        <span className="jt-pill" style={{ background: "rgba(120,108,255,.13)", color: "#3a3858" }}>{lv.label}</span>
        {app.analysis && <span className="jt-pill" style={{ background: "#e7efe9", color: "#2f5d4f" }}>Match {app.analysis.coverageScore}%</span>}
        {app.contacts && app.contacts.length > 0 && <span className="jt-pill" style={{ background: "rgba(120,108,255,.13)", color: "#3a3858", display: "inline-flex", alignItems: "center", gap: 4 }}><Users size={11} />{app.contacts.length}</span>}
      </div>
      <div className="jt-list-actions" onClick={(e) => e.stopPropagation()}>
        <select value={app.stage} onChange={(e) => onMove(e.target.value)} title="Status"
          style={{ appearance: "none", fontFamily: "inherit", fontSize: 12, fontWeight: 600, padding: "6px 9px", border: "1px solid var(--line)", borderRadius: 8, color: stage.color, background: "var(--card)", cursor: "pointer" }}>
          {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        {app.link && <a className="jt-icon" href={app.link} target="_blank" rel="noreferrer"><ExternalLink size={15} /></a>}
        <button className="jt-icon danger" onClick={onDelete}><Trash2 size={15} /></button>
      </div>
    </div>
  );
}

function AddModal({ onSave, onClose }) {
  const [f, setF] = useState(blankApp());
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="jt-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="jt-modal sm">
        <div className="jt-modal-head"><h2>Add a role</h2><button className="jt-icon" onClick={onClose}><X size={20} /></button></div>
        <div style={{ marginTop: 10 }}>
          <div className="jt-field"><label>Company</label><input autoFocus value={f.company} onChange={set("company")} placeholder="e.g. Two Sigma" /></div>
          <div className="jt-field"><label>Role</label><input value={f.role} onChange={set("role")} placeholder="e.g. Campus Data Scientist" /></div>
          <div className="jt-field"><label>Posting link</label><input value={f.link} onChange={set("link")} placeholder="https://…" /></div>
          <div className="jt-field"><label>Job platform</label>
            <div className="jt-hint">Where you found this role</div>
            <PlatformInput value={f.platform} onChange={set("platform")} /></div>
          <div className="jt-field"><label>Status</label>
            <div className="jt-hint">Where this application stands right now</div>
            <select value={f.stage} onChange={set("stage")}>{STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div>
          <div className="jt-field"><label>Sponsorship</label>
            <div className="jt-hint">Does this employer sponsor work visas (e.g. H-1B)?</div>
            <select value={f.sponsorship} onChange={set("sponsorship")}><option value="confirmed">Sponsors visas</option><option value="unknown">Unverified</option><option value="no">No sponsorship</option></select></div>
          <div className="jt-field"><label>Role level</label>
            <div className="jt-hint">Seniority the posting targets</div>
            <select value={f.level} onChange={set("level")}><option value="internship">Internship</option><option value="newgrad">New grad</option><option value="entry">Entry-level · 0–2 yrs</option><option value="mid">Mid-level · 3–5 yrs</option><option value="senior">Senior · 6+ yrs</option></select></div>
          <div className="jt-field"><label>Notes</label>
            <div className="jt-hint">Anything to remember — referral name, why it fits, deadlines…</div>
            <textarea value={f.notes} onChange={set("notes")} placeholder="Add any comments or notes about this role…" /></div>
          <div className="jt-foot">
            <button className="jt-btn jt-ghost" onClick={onClose}>Cancel</button>
            <button className="jt-btn jt-primary" onClick={() => f.company.trim() && onSave(f)}>Add to pipeline</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================ Shared match results =========================
// the resume↔JD comparison UI, shared by the role view and the JD Keywords tab.
// parent owns `tailored` so the rewrites can be saved per role.
function MatchResults({ resume, jd, analysis, tailored, onTailoredChange }) {
  const an = analysis, tl = tailored;
  const checks = formatChecks(resume);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copiedT, setCopiedT] = useState(false);
  const runTailor = async () => {
    setErr(""); setBusy(true);
    try { onTailoredChange(await tailorResume(resume, jd, an)); }
    catch (e) { setErr("Tailoring failed — " + e.message); }
    setBusy(false);
  };
  const copyTailored = () => {
    if (!tl) return;
    const text = [...(tl.rewrites || []).map((r) => r.after), tl.skillsLine ? `Skills: ${tl.skillsLine}` : ""].filter(Boolean).join("\n");
    navigator.clipboard?.writeText(text); setCopiedT(true); setTimeout(() => setCopiedT(false), 1500);
  };
  return (
    <>
      <div className="jt-score-wrap">
        <Ring value={an.coverageScore} />
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Keyword coverage vs this JD</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 }}>A proxy for ATS readiness — how much of the role's key terminology your resume contains. Not a guaranteed pass; use it to spot gaps.</div>
        </div>
      </div>
      {an.sponsorship && (() => {
        const sp = an.sponsorship;
        const map = {
          offered: { label: "Sponsorship mentioned", bg: "#e6f0ea", color: "#2f7d5b" },
          not_offered: { label: "No sponsorship", bg: "#f3e6e6", color: "#a85d5d" },
          not_mentioned: { label: "Not mentioned", bg: "#f5edda", color: "#b8860b" },
        };
        const m = map[sp.status] || map.not_mentioned;
        const mentions = sp.mentions || [];
        return (
          <div className="jt-panel">
            <h4 style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>Visa sponsorship
              <span className="jt-chip" style={{ background: m.bg, color: m.color, margin: 0 }}>{m.label}</span></h4>
            <div className="jt-hint" style={{ margin: "0 0 10px" }}>Everything the posting says about visa / work authorization, quoted as-is — read and decide for yourself.</div>
            {mentions.length === 0
              ? <div style={{ fontSize: 13.5, color: "var(--muted)" }}>Nothing about sponsorship or work authorization was found in this job description.</div>
              : <ul className="jt-suggest" style={{ marginTop: 0 }}>{mentions.map((q, i) => <li key={i} style={{ fontStyle: "italic" }}>“{q}”</li>)}</ul>}
          </div>
        );
      })()}
      <div className="jt-panel">
        <h4>Resume format checks</h4>
        <ul className="jt-checks">{checks.map((c, i) => (
          <li key={i}>{c.ok ? <Check size={15} color="#2f7d5b" /> : <X size={15} color="#a85d5d" />}<span style={{ color: c.ok ? "var(--ink)" : "var(--muted)" }}>{c.label}</span></li>
        ))}</ul>
      </div>
      <div className="jt-panel">
        <h4>Keywords {an.missing && an.missing.length > 0 && <span style={{ fontWeight: 400, fontSize: 13, color: "var(--muted)" }}>· {an.missing.length} missing</span>}</h4>
        <div>{an.keywords.map((k, i) => (
          <span key={i} className="jt-chip" style={k.present ? { background: "#e6f0ea", color: "#2f7d5b" } : { background: "#f5edda", color: "#b8860b" }}>{k.term}</span>
        ))}</div>
      </div>
      <div className="jt-panel">
        <h4>Tailoring suggestions</h4>
        <ul className="jt-suggest">{an.tailoring.map((t, i) => <li key={i}>{t}</li>)}</ul>
      </div>
      <div className="jt-panel">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <h4 style={{ margin: 0 }}>ATS-friendly rewrites</h4>
          <div style={{ display: "flex", gap: 8 }}>
            {tl && <button className="jt-btn jt-ghost" onClick={copyTailored}>{copiedT ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy rewrites</>}</button>}
            <button className="jt-btn jt-primary" onClick={runTailor} disabled={busy}>
              {busy ? <><Loader2 size={15} className="jt-spin" /> Tailoring…</> : <><Sparkles size={15} /> {tl ? "Regenerate" : "Apply suggestions"}</>}
            </button>
          </div>
        </div>
        <div className="jt-hint" style={{ margin: "8px 0 0" }}>Turns the suggestions into concrete, honest resume edits — rephrasing your real experience to mirror the JD's wording. Nothing is invented.</div>
        {err && <div className="jt-note" style={{ background: "#f3e6e6", color: "#a85d5d", marginTop: 12 }}>{err}</div>}
        {tl && (
          <div style={{ marginTop: 14 }}>
            {(tl.rewrites || []).map((r, i) => (
              <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12, marginBottom: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "#a85d5d", marginBottom: 4 }}>Before</div>
                <div style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--muted)", marginBottom: 10 }}>{r.before}</div>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "#2f7d5b", marginBottom: 4 }}>After</div>
                <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>{r.after}</div>
                {r.adds && r.adds.length > 0 && <div style={{ marginTop: 8 }}>{r.adds.map((a, j) => <span key={j} className="jt-chip" style={{ background: "#e6f0ea", color: "#2f7d5b" }}>{a}</span>)}</div>}
              </div>
            ))}
            {tl.skillsLine && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--muted)", marginBottom: 6 }}>Skills line to add</div>
                <div className="jt-note">{tl.skillsLine}</div>
              </div>
            )}
            {tl.atsFixes && tl.atsFixes.length > 0 && (
              <div style={{ marginBottom: tl.gaps && tl.gaps.length ? 12 : 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--muted)", marginBottom: 6 }}>ATS formatting fixes</div>
                <ul className="jt-suggest" style={{ marginTop: 0 }}>{tl.atsFixes.map((f, i) => <li key={i}>{f}</li>)}</ul>
              </div>
            )}
            {tl.gaps && tl.gaps.length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "#a85d5d", marginBottom: 6 }}>Honest gaps — don't claim these</div>
                <ul className="jt-suggest" style={{ marginTop: 0 }}>{tl.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="jt-panel">
        <h4>Highlighted job description</h4>
        <div className="jt-jd" dangerouslySetInnerHTML={{ __html: highlightJD(jd, an.keywords) }} />
      </div>
    </>
  );
}

// ============================ JD Keywords / compare tab =====================
function KeywordsView() {
  const [jd, setJd] = useState("");
  const [resume, setResume] = useState("");           // session-only, cleared on refresh
  const [resumeName, setResumeName] = useState("");
  const [res, setRes] = useState(null);       // JD-only keyword extraction
  const [an, setAn] = useState(null);         // resume↔JD comparison
  const [tl, setTl] = useState(null);         // ATS rewrites for the comparison
  const [busy, setBusy] = useState("");       // "" | "keywords" | "analyze"
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [rUp, setRUp] = useState(false), [rErr, setRErr] = useState("");
  const [preview, setPreview] = useState(false);

  const runKeywords = async () => {
    setErr("");
    if (!jd.trim()) { setErr("Paste a job description first."); return; }
    setBusy("keywords"); setAn(null); setTl(null);
    try { setRes(await extractKeywords(jd)); }
    catch (e) { setErr("Couldn't analyze it — " + e.message); }
    setBusy("");
  };
  const runCompare = async () => {
    setErr("");
    if (!resume.trim()) { setErr("Upload your resume first."); return; }
    if (!jd.trim()) { setErr("Paste a job description first."); return; }
    setBusy("analyze"); setRes(null);
    try { setAn(await analyzeJD(resume, jd)); setTl(null); }
    catch (e) { setErr("Couldn't compare them — " + e.message); }
    setBusy("");
  };
  const onUpload = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setRErr(""); setRUp(true);
    try { const text = await extractResumeText(file); setResume(text); setResumeName(file.name); }
    catch (err) { setRErr(err.message); }
    setRUp(false);
  };
  const copyAll = () => {
    if (!res) return;
    navigator.clipboard?.writeText(res.keywords.map((k) => k.term).join(", "));
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };

  const CATS = [["skill", "Skills"], ["tool", "Tools & tech"], ["qualification", "Qualifications"], ["responsibility", "Responsibilities"]];
  const known = new Set(["skill", "tool", "qualification", "responsibility"]);

  const hasResume = resume.trim().length > 0;
  return (
    <div>
      <div className="jt-note" style={{ marginBottom: 16 }}>Paste a job description to pull out the keywords worth mirroring. Add your resume too and we'll compare the two — coverage score, what's missing, and ATS-friendly rewrites.</div>
      <div className="jt-field">
        <label>Your resume <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "var(--muted)" }}>· optional, for the comparison</span></label>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <label className="jt-btn jt-ghost" style={{ cursor: rUp ? "default" : "pointer", opacity: rUp ? 0.55 : 1 }}>
            {rUp ? <><Loader2 size={15} className="jt-spin" /> Reading…</> : <><Upload size={15} /> {hasResume ? "Replace resume" : "Upload resume"}</>}
            <input type="file" accept=".pdf,.docx,.txt,.md" style={{ display: "none" }} disabled={rUp} onChange={onUpload} />
          </label>
          <span style={{ fontSize: 13, color: hasResume ? "#2f7d5b" : "var(--muted)", display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            {hasResume
              ? <>
                  <Check size={14} style={{ flexShrink: 0 }} />
                  <span style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={resumeName || "Resume"}>{resumeName || "Resume"}</span>
                  <button type="button" onClick={() => setPreview(true)}
                    style={{ background: "none", border: "none", color: "var(--accent)", fontWeight: 600, cursor: "pointer", padding: 0, font: "inherit", display: "inline-flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
                    <Eye size={13} /> Preview</button>
                </>
              : "No resume yet"}
          </span>
        </div>
        {rErr && <div className="jt-note" style={{ background: "#f3e6e6", color: "#a85d5d", marginTop: 8 }}>{rErr}</div>}
      </div>
      {preview && (
        <div className="jt-overlay" style={{ zIndex: 60 }} onMouseDown={(e) => e.target === e.currentTarget && setPreview(false)}>
          <div className="jt-modal" style={{ maxWidth: 760, display: "flex", flexDirection: "column", maxHeight: "88vh" }}>
            <div className="jt-modal-head">
              <div>
                <h2 style={{ fontSize: 19 }}>{resumeName || "Resume"}</h2>
                <div className="jt-role">Resume text · {resume.split(/\s+/).filter(Boolean).length} words</div>
              </div>
              <button className="jt-icon" onClick={() => setPreview(false)}><X size={20} /></button>
            </div>
            <pre style={{ flex: 1, overflow: "auto", whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13.5, lineHeight: 1.6, color: "var(--ink)", background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 16, margin: "6px 0 0" }}>{resume || "No resume text available."}</pre>
          </div>
        </div>
      )}
      <div className="jt-field"><label>Job description</label>
        <textarea style={{ minHeight: 160 }} value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Paste the full job description…" /></div>
      <div className="jt-foot" style={{ justifyContent: "flex-start", marginBottom: 16, flexWrap: "wrap" }}>
        {hasResume && (
          <button className="jt-btn jt-primary" onClick={runCompare} disabled={busy === "analyze"}>
            {busy === "analyze" ? <><Loader2 size={15} className="jt-spin" /> Comparing…</> : <><Sparkles size={15} /> Compare resume ↔ JD</>}
          </button>
        )}
        <button className={"jt-btn " + (hasResume ? "jt-ghost" : "jt-primary")} onClick={runKeywords} disabled={busy === "keywords"}>
          {busy === "keywords" ? <><Loader2 size={15} className="jt-spin" /> Finding keywords…</> : <><Search size={15} /> {hasResume ? "Just keywords" : "Find keywords"}</>}
        </button>
        {res && <button className="jt-btn jt-ghost" onClick={copyAll}>{copied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy all</>}</button>}
      </div>
      {err && <div className="jt-note" style={{ background: "#f3e6e6", color: "#a85d5d", marginBottom: 14 }}>{err}</div>}
      {an && <MatchResults resume={resume} jd={jd} analysis={an} tailored={tl} onTailoredChange={setTl} />}
      {res && (
        <>
          <div className="jt-panel"><h4>What this role wants</h4>
            <div style={{ fontSize: 14, lineHeight: 1.6 }}>{res.summary}</div></div>
          <div className="jt-panel">
            <h4>Important keywords <span style={{ fontWeight: 400, fontSize: 13, color: "var(--muted)" }}>· green = high priority</span></h4>
            {CATS.map(([cat, label]) => {
              const items = res.keywords.filter((k) => k.category === cat);
              if (!items.length) return null;
              return (
                <div key={cat} style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--muted)", marginBottom: 7 }}>{label}</div>
                  <div>{items.map((k, i) => (
                    <span key={i} className="jt-chip" style={k.importance === "high" ? { background: "#e6f0ea", color: "#2f7d5b" } : { background: "#f5edda", color: "#b8860b" }}>{k.term}</span>
                  ))}</div>
                </div>
              );
            })}
            {res.keywords.some((k) => !known.has(k.category)) && (
              <div><div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--muted)", marginBottom: 7 }}>Other</div>
                <div>{res.keywords.filter((k) => !known.has(k.category)).map((k, i) => (
                  <span key={i} className="jt-chip" style={k.importance === "high" ? { background: "#e6f0ea", color: "#2f7d5b" } : { background: "#f5edda", color: "#b8860b" }}>{k.term}</span>
                ))}</div></div>
            )}
          </div>
          <div className="jt-panel"><h4>Highlighted description</h4>
            <div className="jt-jd" dangerouslySetInnerHTML={{ __html: highlightJD(jd, res.keywords.map((k) => ({ ...k, present: k.importance === "high" }))) }} /></div>
        </>
      )}
    </div>
  );
}

// ============================ Notes ========================================
const blankNote = () => ({ id: crypto.randomUUID(), title: "", body: "", updatedAt: Date.now() });
const fmtNoteDate = (ts) => (ts ? new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");
const stripHtml = (html) => { const d = document.createElement("div"); d.innerHTML = html || ""; return (d.textContent || "").replace(/\s+/g, " ").trim(); };

// small rich-text editor on contentEditable + execCommand, stores HTML.
// set the html once (uncontrolled) so the cursor doesn't jump — key it to reload.
function RichEditor({ value, onChange }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.innerHTML = value || ""; }, []);   // init once
  const exec = (cmd, arg) => {
    if (ref.current) ref.current.focus();
    document.execCommand(cmd, false, arg);
    if (ref.current) onChange(ref.current.innerHTML);
  };
  const Btn = ({ cmd, arg, title, children }) => (
    <button type="button" title={title} onMouseDown={(e) => e.preventDefault()} onClick={() => exec(cmd, arg)}>{children}</button>
  );
  return (
    <div>
      <div className="jt-rt-toolbar">
        <Btn cmd="formatBlock" arg="H2" title="Large heading"><Heading size={15} /></Btn>
        <Btn cmd="formatBlock" arg="H3" title="Small heading"><span style={{ fontWeight: 700, fontSize: 12 }}>H3</span></Btn>
        <Btn cmd="formatBlock" arg="P" title="Normal text"><span style={{ fontSize: 12 }}>¶</span></Btn>
        <span className="sep" />
        <Btn cmd="bold" title="Bold"><Bold size={15} /></Btn>
        <Btn cmd="italic" title="Italic"><Italic size={15} /></Btn>
        <Btn cmd="underline" title="Underline"><Underline size={15} /></Btn>
        <span className="sep" />
        <Btn cmd="insertUnorderedList" title="Bullet list"><List size={15} /></Btn>
        <Btn cmd="insertOrderedList" title="Numbered list"><ListOrdered size={15} /></Btn>
      </div>
      <div ref={ref} className="jt-rt-body" contentEditable suppressContentEditableWarning
        data-placeholder="Write your note… use the toolbar for headings, bold, and bullets."
        onInput={() => onChange(ref.current.innerHTML)} />
    </div>
  );
}

function NotesView({ notes, onChange }) {
  const [editing, setEditing] = useState(null);   // the note draft being edited, or null
  const [isNew, setIsNew] = useState(false);
  const [query, setQuery] = useState("");

  const openNew = () => { setEditing(blankNote()); setIsNew(true); };
  const openEdit = (n) => { setEditing({ ...n }); setIsNew(false); };
  const cancel = () => { setEditing(null); setIsNew(false); };
  const save = () => {
    const n = { ...editing, updatedAt: Date.now() };
    if (!n.title.trim() && !stripHtml(n.body)) { cancel(); return; }   // discard empty notes
    const exists = notes.some((x) => x.id === n.id);
    onChange(exists ? notes.map((x) => (x.id === n.id ? n : x)) : [n, ...notes]);
    cancel();
  };
  const del = (id) => { onChange(notes.filter((x) => x.id !== id)); cancel(); };

  const visible = notes
    .filter((n) => !query || ((n.title || "") + " " + stripHtml(n.body)).toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  return (
    <div>
      <div className="jt-filters">
        <div className="jt-search"><Search size={15} />
          <input placeholder="Search notes…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <button className="jt-btn jt-primary" onClick={openNew}><Plus size={16} /> New note</button>
      </div>

      {notes.length === 0 ? <div className="jt-empty">No notes yet. Hit <strong>New note</strong> to jot something down.</div>
        : visible.length === 0 ? <div className="jt-empty">No notes match your search.</div>
        : (
          <div className="jt-list">
            {visible.map((n) => (
              <div className="jt-list-row" key={n.id} onClick={() => openEdit(n)}>
                <div className="jt-list-main">
                  <div className="jt-list-co">{n.title || "Untitled note"}</div>
                  {stripHtml(n.body) && <div className="jt-list-role">{stripHtml(n.body).slice(0, 140)}</div>}
                </div>
                <div className="jt-list-actions" onClick={(e) => e.stopPropagation()}>
                  <span className="jt-meta-date">{fmtNoteDate(n.updatedAt)}</span>
                  <button className="jt-icon danger" onClick={() => del(n.id)} title="Delete note"><Trash2 size={15} /></button>
                </div>
              </div>
            ))}
          </div>
        )}

      {editing && (
        <div className="jt-overlay" onMouseDown={(e) => e.target === e.currentTarget && cancel()}>
          <div className="jt-modal sm">
            <div className="jt-modal-head"><h2>{isNew ? "New note" : "Edit note"}</h2><button className="jt-icon" onClick={cancel}><X size={20} /></button></div>
            <div style={{ marginTop: 10 }}>
              <div className="jt-field"><label>Title</label>
                <input autoFocus value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="Note title" /></div>
              <div className="jt-field"><label>Note</label>
                <RichEditor key={editing.id} value={editing.body} onChange={(html) => setEditing({ ...editing, body: html })} /></div>
              <div className="jt-foot">
                {!isNew && <button className="jt-btn jt-ghost" style={{ marginRight: "auto", color: "#a85d5d" }} onClick={() => del(editing.id)}><Trash2 size={15} /> Delete</button>}
                <button className="jt-btn jt-ghost" onClick={cancel}>Cancel</button>
                <button className="jt-btn jt-primary" onClick={save}>Save note</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================ Role workspace ================================
function Workspace({ app, docLinks, onUpdate, onClose }) {
  const [draft, setDraft] = useState(app);
  const [tab, setTab] = useState("details");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [rUp, setRUp] = useState(false);
  const [rErr, setRErr] = useState("");
  const [preview, setPreview] = useState(false);
  const [apUp, setApUp] = useState(false);
  const [apErr, setApErr] = useState("");
  const [previewFile, setPreviewFile] = useState(null);   // { id, name } for the applied-resume PDF preview
  const [previewUrl, setPreviewUrl] = useState("");        // blob URL, or "error"
  // each role keeps its own resume
  const resume = draft.resumeText || "";
  const resumeName = draft.resumeName || "";
  const resumeId = draft.resumeId || null;

  // load the applied resume as a blob (with the auth header) so it previews inline
  useEffect(() => {
    if (!previewFile) { setPreviewUrl(""); return; }
    let url, cancelled = false;
    fetch(`${API_BASE}/api/files/${previewFile.id}`, { headers: { ...authHeader() } })
      .then((r) => { if (!r.ok) throw new Error(); return r.blob(); })
      .then((b) => { if (!cancelled) { url = URL.createObjectURL(b); setPreviewUrl(url); } })
      .catch(() => { if (!cancelled) setPreviewUrl("error"); });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [previewFile]);
  const set = (k) => (e) => setDraft({ ...draft, [k]: e.target.value });
  const flush = (d) => { onUpdate(d); };
  const close = () => { onUpdate(draft); onClose(); };
  const contacts = draft.contacts || [];
  const addContact = () => setDraft({ ...draft, contacts: [...contacts, { id: crypto.randomUUID(), name: "", type: "Referral", handle: "" }] });
  const setContact = (id, k, v) => setDraft({ ...draft, contacts: contacts.map((c) => (c.id === id ? { ...c, [k]: v } : c)) });
  const delContact = (id) => setDraft({ ...draft, contacts: contacts.filter((c) => c.id !== id) });

  const runAnalyze = async () => {
    setErr("");
    if (!resume.trim()) { setErr("Upload your resume on this tab first (Your resume → Upload)."); return; }
    if (!draft.jd.trim()) { setErr("Paste the job description first."); return; }
    setBusy("analyze");
    try { const a = await analyzeJD(resume, draft.jd); const d = { ...draft, analysis: a, tailored: null }; setDraft(d); flush(d); }
    catch (e) { setErr("Analysis failed — " + e.message); }
    setBusy("");
  };
  const runCover = async () => {
    setErr("");
    if (!resume.trim()) { setErr("Upload your resume on this tab first (Your resume → Upload)."); return; }
    if (!draft.jd.trim()) { setErr("Paste the job description (Tailor tab) first."); return; }
    setBusy("cover");
    try { const t = await writeCoverLetter(resume, draft.jd, draft.company, draft.role); const d = { ...draft, coverLetter: t }; setDraft(d); flush(d); }
    catch (e) { setErr("Generation failed — " + e.message); }
    setBusy("");
  };
  const copyCover = () => { navigator.clipboard?.writeText(draft.coverLetter); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  const onUploadResume = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setRErr(""); setRUp(true);
    try {
      const meta = await uploadResumeFile(file);   // stores the file (for preview)
      if (!meta.hasText) throw new Error("No readable text found — try a text-based PDF or a DOCX (not a scanned image).");
      const text = await fetchFileText(meta.id);
      // swap the resume for this role and drop the now-stale score/rewrites
      const d = { ...draft, resumeText: text, resumeId: meta.id, resumeName: meta.name, analysis: null, tailored: null };
      setDraft(d); flush(d);
    } catch (err) { setRErr(err.message); }
    setRUp(false);
  };
  // the actual resume submitted for this job — just stored + previewable
  const onUploadApplied = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setApErr(""); setApUp(true);
    try {
      const meta = await uploadResumeFile(file);
      const d = { ...draft, appliedResumeId: meta.id, appliedResumeName: meta.name };
      setDraft(d); flush(d);
    } catch (err) { setApErr(err.message); }
    setApUp(false);
  };

  const an = draft.analysis;

  return (
    <div className="jt-overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="jt-modal">
        <div className="jt-modal-head">
          <div><h2>{draft.company || "Untitled"}</h2>{draft.role && <div className="jt-role">{draft.role}</div>}</div>
          <button className="jt-icon" onClick={close}><X size={20} /></button>
        </div>
        <div className="jt-tabs">
          <button className={tab === "details" ? "on" : ""} onClick={() => setTab("details")}><FileText size={15} /> Details</button>
          <button className={tab === "tailor" ? "on" : ""} onClick={() => setTab("tailor")}><Sparkles size={15} /> Resume match</button>
          <button className={tab === "cover" ? "on" : ""} onClick={() => setTab("cover")}><FileText size={15} /> Cover letter</button>
        </div>

        {err && <div className="jt-note" style={{ background: "#f3e6e6", color: "#a85d5d", marginBottom: 14 }}>{err}</div>}

        {tab === "details" && (
          <div>
            <div className="jt-row"><div className="jt-field"><label>Company</label><input value={draft.company} onChange={set("company")} /></div>
              <div className="jt-field"><label>Role</label><input value={draft.role} onChange={set("role")} /></div></div>
            <div className="jt-field"><label>Posting link</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input style={{ flex: 1 }} value={draft.link} onChange={set("link")} placeholder="https://…" />
                {draft.link.trim() && <a className="jt-btn jt-ghost" href={withProtocol(draft.link)} target="_blank" rel="noreferrer" title="Open posting in a new tab" style={{ padding: "0 13px", display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 }}><ExternalLink size={15} /> Open</a>}
              </div>
            </div>
            <div className="jt-field"><label>Job platform</label>
              <div className="jt-hint">Where you found this role</div>
              <PlatformInput value={draft.platform} onChange={set("platform")} /></div>
            <div className="jt-field"><label>Status</label>
              <div className="jt-hint">Where this application stands right now</div>
              <select value={draft.stage} onChange={set("stage")}>{STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div>
            <div className="jt-field"><label>Sponsorship</label>
              <div className="jt-hint">Does this employer sponsor work visas (e.g. H-1B)?</div>
              <select value={draft.sponsorship} onChange={set("sponsorship")}><option value="confirmed">Sponsors visas</option><option value="unknown">Unverified</option><option value="no">No sponsorship</option></select></div>
            <div className="jt-field"><label>Role level</label>
              <div className="jt-hint">Seniority the posting targets</div>
              <select value={draft.level} onChange={set("level")}><option value="internship">Internship</option><option value="newgrad">New grad</option><option value="entry">Entry-level · 0–2 yrs</option><option value="mid">Mid-level · 3–5 yrs</option><option value="senior">Senior · 6+ yrs</option></select></div>
            <div className="jt-row">
              <div className="jt-field"><label>Work model</label>
                <select value={draft.workModel} onChange={set("workModel")}><option value="">—</option><option value="Remote">Remote</option><option value="Hybrid">Hybrid</option><option value="On-site">On-site</option></select></div>
              <div className="jt-field"><label>Location</label><input value={draft.location} onChange={set("location")} placeholder="e.g. New York, NY" /></div>
            </div>
            <div className="jt-field"><label>Comp range</label><input value={draft.comp} onChange={set("comp")} placeholder="e.g. $95–115k" /></div>
            <div className="jt-field"><label>Date applied</label><input type="date" value={draft.dateApplied} onChange={set("dateApplied")} /></div>
            <div className="jt-field">
              <label>Resume used to apply</label>
              <div className="jt-hint" style={{ margin: "0 0 8px" }}>The actual resume file you submitted for this job — saved with this record.</div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <label className="jt-btn jt-ghost" style={{ cursor: apUp ? "default" : "pointer", opacity: apUp ? 0.55 : 1 }}>
                  {apUp ? <><Loader2 size={15} className="jt-spin" /> Uploading…</> : <><Upload size={15} /> {draft.appliedResumeId ? "Replace file" : "Upload resume"}</>}
                  <input type="file" accept=".pdf,.docx,.txt,.md" style={{ display: "none" }} disabled={apUp} onChange={onUploadApplied} />
                </label>
                {draft.appliedResumeId && (
                  <span style={{ fontSize: 13, color: "#2f7d5b", display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <Check size={14} style={{ flexShrink: 0 }} />
                    <span style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={draft.appliedResumeName || "Resume"}>{draft.appliedResumeName || "Resume"}</span>
                    <button type="button" onClick={() => setPreviewFile({ id: draft.appliedResumeId, name: draft.appliedResumeName })}
                      style={{ background: "none", border: "none", color: "var(--accent)", fontWeight: 600, cursor: "pointer", padding: 0, font: "inherit", display: "inline-flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
                      <Eye size={13} /> Preview</button>
                  </span>
                )}
              </div>
              {apErr && <div className="jt-note" style={{ background: "#f3e6e6", color: "#a85d5d", marginTop: 8 }}>{apErr}</div>}
            </div>
            <div className="jt-field"><label>Next step</label><input value={draft.nextStep} onChange={set("nextStep")} placeholder="e.g. Email recruiter, send thank-you note" /></div>
            <div className="jt-field"><label>Notes</label><textarea value={draft.notes} onChange={set("notes")} placeholder="DOL data, why it fits…" /></div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".05em", marginTop: 8, marginBottom: 4 }}>Contacts</div>
            <div className="jt-hint" style={{ margin: "0 0 10px" }}>Referrals, recruiters, and people you've cold-emailed for this role.</div>
            {contacts.map((c) => (
              <div className="jt-contact" key={c.id}>
                <input placeholder="Name" value={c.name} onChange={(e) => setContact(c.id, "name", e.target.value)} />
                <select value={c.type} onChange={(e) => setContact(c.id, "type", e.target.value)}>{CONTACT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                <input className="jt-c-handle" placeholder="Email or LinkedIn" value={c.handle} onChange={(e) => setContact(c.id, "handle", e.target.value)} />
                <button className="jt-icon danger" onClick={() => delContact(c.id)}><Trash2 size={15} /></button>
              </div>
            ))}
            <button className="jt-btn jt-ghost" style={{ marginTop: 2, marginBottom: 4 }} onClick={addContact}><UserPlus size={15} /> Add contact</button>
            <div className="jt-foot"><button className="jt-btn jt-primary" onClick={() => flush(draft)}>Save</button></div>
          </div>
        )}

        {tab === "tailor" && (
          <div>
            <div className="jt-field">
              <label>Your resume</label>
              <div className="jt-hint" style={{ margin: "0 0 8px" }}>Upload a PDF, DOCX, or TXT — we read the text for you. Reused across all roles.</div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <label className="jt-btn jt-ghost" style={{ cursor: rUp ? "default" : "pointer", opacity: rUp ? 0.55 : 1 }}>
                  {rUp ? <><Loader2 size={15} className="jt-spin" /> Reading…</> : <><Upload size={15} /> {resume.trim() ? "Replace resume" : "Upload resume"}</>}
                  <input type="file" accept=".pdf,.docx,.txt,.md" style={{ display: "none" }} disabled={rUp} onChange={onUploadResume} />
                </label>
                <span style={{ fontSize: 13, color: resume.trim() ? "#2f7d5b" : "var(--muted)", display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  {resume.trim()
                    ? <>
                        <Check size={14} style={{ flexShrink: 0 }} />
                        <span style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={resumeName || "Resume"}>{resumeName || "Resume"}</span>
                        <button type="button" onClick={() => setPreview(true)}
                          style={{ background: "none", border: "none", color: "var(--accent)", fontWeight: 600, cursor: "pointer", padding: 0, font: "inherit", display: "inline-flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
                          <Eye size={13} /> Preview</button>
                      </>
                    : "No resume yet"}
                </span>
              </div>
              {rErr && <div className="jt-note" style={{ background: "#f3e6e6", color: "#a85d5d", marginTop: 8 }}>{rErr}</div>}
            </div>
            {preview && (
              <div className="jt-overlay" style={{ zIndex: 60 }} onMouseDown={(e) => e.target === e.currentTarget && setPreview(false)}>
                <div className="jt-modal" style={{ maxWidth: 760, display: "flex", flexDirection: "column", maxHeight: "88vh" }}>
                  <div className="jt-modal-head">
                    <div>
                      <h2 style={{ fontSize: 19 }}>{resumeName || "Resume"}</h2>
                      <div className="jt-role">Resume text · {resume.split(/\s+/).filter(Boolean).length} words</div>
                    </div>
                    <button className="jt-icon" onClick={() => setPreview(false)}><X size={20} /></button>
                  </div>
                  <pre style={{ flex: 1, overflow: "auto", whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13.5, lineHeight: 1.6, color: "var(--ink)", background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: 16, margin: "6px 0 0" }}>{resume || "No resume text available."}</pre>
                </div>
              </div>
            )}
            <div className="jt-field"><label>Job description</label>
              <textarea style={{ minHeight: 130 }} value={draft.jd} onChange={set("jd")} placeholder="Paste the full job description here…" /></div>
            <div className="jt-foot" style={{ justifyContent: "flex-start", marginBottom: 16 }}>
              <button className="jt-btn jt-primary" onClick={runAnalyze} disabled={busy === "analyze"}>
                {busy === "analyze" ? <><Loader2 size={15} className="jt-spin" /> Analyzing…</> : <><Sparkles size={15} /> Analyze match</>}
              </button>
            </div>
            {an && (
              <MatchResults
                resume={resume}
                jd={draft.jd}
                analysis={an}
                tailored={draft.tailored}
                onTailoredChange={(t) => { const d = { ...draft, tailored: t }; setDraft(d); flush(d); }}
              />
            )}
          </div>
        )}

        {tab === "cover" && (
          <div>
            <div className="jt-foot" style={{ justifyContent: "flex-start", marginBottom: 14 }}>
              <button className="jt-btn jt-primary" onClick={runCover} disabled={busy === "cover"}>
                {busy === "cover" ? <><Loader2 size={15} className="jt-spin" /> Writing…</> : <><Sparkles size={15} /> {draft.coverLetter ? "Regenerate" : "Generate cover letter"}</>}
              </button>
              {draft.coverLetter && <button className="jt-btn jt-ghost" onClick={copyCover}>{copied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy</>}</button>}
            </div>
            {!resume.trim() && <div className="jt-note" style={{ marginBottom: 14 }}>Upload your resume on the <button onClick={() => setTab("tailor")} style={{ background: "none", border: "none", color: "var(--accent)", fontWeight: 700, cursor: "pointer", padding: 0, font: "inherit" }}>Resume match</button> tab to enable this.</div>}
            <div className="jt-panel" style={{ marginBottom: 14 }}>
              <h4 style={{ margin: "0 0 8px" }}>Make it valuable — edit the draft to add these</h4>
              <ul className="jt-suggest" style={{ marginTop: 0, marginBottom: 0 }}>
                <li><strong>One specific detail about the company</strong> — their product, mission, or a recent launch. Proof you didn't mass-send it.</li>
                <li><strong>Quantify every claim</strong> — "cut ETL runtime 40%", not "improved performance".</li>
                <li><strong>Show, don't tell</strong> — give the achievement, not adjectives like "hard-working" or "passionate".</li>
                <li><strong>Lead with value to them</strong>, not what the role does for you.</li>
                <li><strong>Mirror the JD's wording</strong> and keep it ~250–350 words (one page).</li>
              </ul>
              <div className="jt-hint" style={{ margin: "10px 0 0" }}>The generator gives you a strong ~80% draft from your real experience — these tweaks are the last 20% that make it read like you wrote it for this role.</div>
            </div>
            <div className="jt-field">
              <textarea style={{ minHeight: 360, fontSize: 14 }} value={draft.coverLetter} onChange={set("coverLetter")} placeholder="Your generated cover letter will appear here, fully editable…" />
            </div>
            <div className="jt-foot"><button className="jt-btn jt-primary" onClick={() => flush(draft)}>Save letter</button></div>
          </div>
        )}

        {previewFile && (
          <div className="jt-overlay" style={{ zIndex: 70 }} onMouseDown={(e) => e.target === e.currentTarget && setPreviewFile(null)}>
            <div className="jt-modal" style={{ maxWidth: 940, display: "flex", flexDirection: "column", maxHeight: "92vh" }}>
              <div className="jt-modal-head">
                <h2 style={{ fontSize: 19, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{previewFile.name || "Resume"}</h2>
                <button className="jt-icon" onClick={() => setPreviewFile(null)}><X size={20} /></button>
              </div>
              {previewUrl === "error"
                ? <div className="jt-empty">Couldn't load the file — make sure the backend is running.</div>
                : previewUrl
                  ? <iframe title="Resume preview" src={previewUrl} style={{ flex: 1, width: "100%", minHeight: 520, border: "1px solid var(--line)", borderRadius: 10, background: "#fff", marginTop: 6 }} />
                  : <div className="jt-empty" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}><Loader2 size={18} className="jt-spin" /> &nbsp;Loading preview…</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
