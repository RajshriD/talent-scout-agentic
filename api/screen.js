const crypto = require("crypto");
const BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MODELS = [process.env.GEMINI_MODEL, "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-flash-latest"].filter(Boolean);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const headers = () => ({ "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY || "" });

async function tryModel(model, prompt) {
  let think = true;
  for (let i = 0; i < 3;) {
    const cfg = { temperature: 0.2, responseMimeType: "application/json" };
    if (think) cfg.thinkingConfig = { thinkingBudget: 0 };          // faster
    let r;
    try {
      r = await fetch(`${BASE}/${model}:generateContent`, { method: "POST", headers: headers(),
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: cfg }),
        signal: AbortSignal.timeout(55000) });
    } catch (e) { return null; }
    if (r.ok) { try { return (await r.json()).candidates[0].content.parts[0].text; } catch (e) { return null; } }
    if (r.status === 400 && think) { think = false; continue; }
    if ((r.status === 429 || r.status === 503) && i < 2) { await sleep(3000 * (i + 1)); i++; continue; }
    return null;
  }
  return null;
}

async function discover() {                                        // models this key can really use
  try {
    const r = await fetch(BASE + "?pageSize=200", { headers: headers(), signal: AbortSignal.timeout(20000) });
    const d = await r.json();
    return (d.models || []).map(m => ({ n: (m.name || "").replace("models/", ""), ok: (m.supportedGenerationMethods || []).includes("generateContent") }))
      .filter(m => m.ok && /flash/.test(m.n) && !/image|tts|live|audio|embed|robot|computer|thinking|exp/.test(m.n))
      .map(m => ({ n: m.n, lite: /lite/.test(m.n), prev: /preview/.test(m.n), v: parseFloat((m.n.match(/gemini-(\d+(?:\.\d+)?)/) || [0, 0])[1]) }))
      .sort((a, b) => (a.lite - b.lite) || (a.prev - b.prev) || (b.v - a.v)).map(m => m.n);
  } catch (e) { return []; }
}

async function geminiJson(prompt) {
  const tried = [];
  for (const group of [MODELS.slice(), null]) {
    const list = group || (await discover()).filter(m => !tried.includes(m));
    for (const m of list) {
      tried.push(m);
      const text = await tryModel(m, prompt);
      if (text) {
        const i = MODELS.indexOf(m); if (i !== 0) { if (i > 0) MODELS.splice(i, 1); MODELS.unshift(m); }
        return JSON.parse(text.trim().replace(/^```(?:json)?|```$/gm, "").trim());
      }
    }
  }
  throw new Error("The AI service is busy or unavailable. Please try again in a minute.");
}

function prompt(jd, resumes, offset) {
  const blocks = resumes.map((r, i) => `[ID ${offset + i}] (file: ${r.name})\n${String(r.text).slice(0, 6000)}`).join("\n\n");
  return `You are an expert recruiter. Read the job description, then for EACH resume extract details and score it (0-100, be strict). Use only text present in the resume; if a detail is missing use "" or 0. Never use or infer protected attributes (age, gender, religion, caste, marital status, name origin). Return ONLY JSON:
{"requirements": {"title": str, "must_have_skills": [str], "nice_to_have_skills": [str], "min_experience_years": number, "max_experience_years": number or null, "locations": [str]},
"candidates": [{"id": int, "name": str, "contact": str, "location": str, "current_role": str, "experience_years": number, "notice_period_days": number, "score": int, "matched_skills": [str], "missing_skills": [str], "strengths": str, "concerns": str, "recommendation": "shortlist|maybe|reject", "outreach": "warm recruiter message, max 70 words, empty string if reject"}]}

JOB DESCRIPTION:
${String(jd).slice(0, 8000)}

RESUMES:
${blocks}`;
}

module.exports = async (req, res) => {
  const pw = process.env.APP_PASSWORD || "";
  if (req.method === "GET")                                         // health check: open /api/screen in a browser
    return res.status(200).json({ status: "running", geminiKeySet: !!process.env.GEMINI_API_KEY, passwordSet: !!pw });
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  let body = req.body;
  try { if (typeof body === "string") body = JSON.parse(body); } catch (e) { return res.status(400).json({ error: "Bad request" }); }
  body = body || {};
  if (pw) {
    const a = Buffer.from(String(body.password || "")), b = Buffer.from(pw);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: "Wrong password. Please try again." });
  }
  if (body.action === "login") return res.status(200).json({ ok: true });
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: "GEMINI_API_KEY is not set on the server." });
  try {
    const rs = (body.resumes || []).slice(0, 6);
    return res.status(200).json(await geminiJson(prompt(body.jd || "", rs, +body.offset || 0)));
  } catch (e) { return res.status(500).json({ error: String(e.message || e).slice(0, 300) }); }
};
