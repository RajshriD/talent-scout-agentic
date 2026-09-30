# Agentic Talent Scout - Vercel version

Files: index.html (the page), api/screen.py (serverless AI function), vercel.json (empty settings).

## Deploy
1. Create a NEW GitHub repo and upload these files keeping the api/ folder (index.html, vercel.json, api/screen.py).
2. On vercel.com: Add New > Project > import the repo. Framework Preset: Other. Leave build settings empty.
3. Before deploying, open Environment Variables and add:
   GEMINI_API_KEY = your free key from aistudio.google.com/apikey
   APP_PASSWORD   = the team password
4. Deploy. Open the link, enter the password, click the sample buttons, then Find best candidates.
Redeploys happen automatically when you commit. If you change env vars, redeploy.

## If Vercel says the api function is missing
The repo must show the path api/screen.py (folder "api", file "screen.py"). On GitHub use
Add file > Create new file, type  api/screen.py  as the name (the slash makes the folder), paste the code, commit.
Long batches: Vercel dashboard > Project > Settings > Functions > Max Duration (raise it if your plan allows).
