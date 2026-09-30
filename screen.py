"""Vercel serverless function: password check + AI screening (Gemini). Stdlib only."""
import hmac, json, os, re, time, urllib.request, urllib.error
from http.server import BaseHTTPRequestHandler

BASE = "https://generativelanguage.googleapis.com/v1beta/models"
MODELS = [m for m in [os.environ.get("GEMINI_MODEL"), "gemini-3.5-flash",
                      "gemini-3.5-flash-lite", "gemini-flash-latest"] if m]

def _key(): return os.environ.get("GEMINI_API_KEY", "")

def _post(url, data):
    req = urllib.request.Request(url, data=data, headers={
        "Content-Type": "application/json", "x-goog-api-key": _key()})
    with urllib.request.urlopen(req, timeout=55) as r:
        return json.load(r)

def _try(model, prompt):
    think, i = True, 0
    while i < 3:
        cfg = {"temperature": 0.2, "responseMimeType": "application/json"}
        if think:
            cfg["thinkingConfig"] = {"thinkingBudget": 0}     # faster
        data = json.dumps({"contents": [{"parts": [{"text": prompt}]}], "generationConfig": cfg}).encode()
        try:
            return _post(f"{BASE}/{model}:generateContent", data)["candidates"][0]["content"]["parts"][0]["text"]
        except urllib.error.HTTPError as e:
            if e.code == 400 and think:
                think = False; continue
            if e.code in (429, 503) and i < 2:
                time.sleep(3 * (i + 1)); i += 1; continue
            return None
        except Exception:
            return None
    return None

def _discover():
    try:
        req = urllib.request.Request(BASE + "?pageSize=200", headers={"x-goog-api-key": _key()})
        with urllib.request.urlopen(req, timeout=20) as r:
            d = json.load(r)
    except Exception:
        return []
    out = []
    for m in d.get("models", []):
        n = m.get("name", "").replace("models/", "")
        if "flash" in n and "generateContent" in m.get("supportedGenerationMethods", []) \
                and not re.search(r"image|tts|live|audio|embed|robot|computer|thinking|exp", n):
            v = re.search(r"gemini-(\d+(?:\.\d+)?)", n)
            out.append(("lite" in n, "preview" in n, -(float(v.group(1)) if v else 0), n))
    return [x[3] for x in sorted(out)]

def gemini_json(prompt):
    tried = []
    for model in list(MODELS) + [None]:
        if model is None:                       # last resort: ask Google what this key can use
            cands = [m for m in _discover() if m not in tried]
        else:
            cands = [model]
        for m in cands:
            tried.append(m)
            text = _try(m, prompt)
            if text:
                if MODELS[:1] != [m]:
                    if m in MODELS: MODELS.remove(m)
                    MODELS.insert(0, m)
                return json.loads(re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.M).strip())
    raise RuntimeError("The AI service is busy or unavailable. Please try again in a minute.")

def screen(jd, resumes, offset=0):
    blocks = "\n\n".join(f"[ID {offset + i}] (file: {r['name']})\n{r['text'][:6000]}" for i, r in enumerate(resumes))
    return gemini_json(f"""You are an expert recruiter. Read the job description, then for EACH resume extract
details and score it (0-100, be strict). Use only text present in the resume; if a detail is missing use ""
or 0. Never use or infer protected attributes (age, gender, religion, caste, marital status, name origin).
Return ONLY JSON:
{{"requirements": {{"title": str, "must_have_skills": [str], "nice_to_have_skills": [str],
"min_experience_years": number, "max_experience_years": number or null, "locations": [str]}},
"candidates": [{{"id": int, "name": str, "contact": str, "location": str, "current_role": str,
"experience_years": number, "notice_period_days": number, "score": int, "matched_skills": [str],
"missing_skills": [str], "strengths": str, "concerns": str,
"recommendation": "shortlist|maybe|reject",
"outreach": "warm recruiter message, max 70 words, empty string if reject"}}]}}

JOB DESCRIPTION:
{jd[:8000]}

RESUMES:
{blocks}""")

class handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers(); self.wfile.write(b)

    def do_POST(self):
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))) or b"{}")
        except Exception:
            return self._send(400, {"error": "Bad request"})
        pw = os.environ.get("APP_PASSWORD", "")
        if pw and not hmac.compare_digest(str(body.get("password", "")), pw):
            return self._send(401, {"error": "Wrong password. Please try again."})
        if body.get("action") == "login":
            return self._send(200, {"ok": True})
        if not _key():
            return self._send(500, {"error": "GEMINI_API_KEY is not set on the server."})
        try:
            rs = body.get("resumes", [])[:6]
            return self._send(200, screen(body.get("jd", ""), rs, int(body.get("offset", 0))))
        except Exception as e:
            return self._send(500, {"error": str(e)[:300]})
