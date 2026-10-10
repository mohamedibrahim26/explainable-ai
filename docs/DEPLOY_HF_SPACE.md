# Deploying Orion-XAI to Hugging Face Spaces (free)

The live demo runs on a free Hugging Face Space: 2 vCPU, 16 GB RAM, no card needed.
Everything (fine-tuned model, Python AI service, Node backend, frontend) runs in one container.

## How it fits together

```
GitHub (main) ──push──▶ GitHub Action ──▶ Hugging Face Space repo ──▶ Docker build ──▶ live app
                                                         ▲
                     Kaggle notebook ──▶ orion-xai-gguf model repo (downloaded during the build)
```

Inside the container, `start.sh` starts:

| Part | Port | Notes |
| --- | --- | --- |
| Ollama + `orion-xai` (4-bit GGUF) | 11434 (internal) | Uses `deploy/hf-space/Modelfile` with the Alpaca template the model was trained on |
| Python AI service (FastAPI) | 8000 (internal) | `FALLBACK_CHAIN=ollama,groq`: Groq only if you add a `GROQ_API_KEY` secret |
| Node backend + frontend | 7860 (public) | SQLite in `/home/user/data`, reset on every restart |

## One-time setup (about 45 minutes, mostly waiting)

### 1. Make the model file (Kaggle, ~25 min)
1. Hugging Face → Settings → Access Tokens → **Create new token**, type **Write**. Copy it.
2. Open `notebooks/export_gguf.ipynb` on Kaggle. Internet **On**, accelerator **None**.
3. Add-ons → Secrets → add `HF_TOKEN` with the token.
4. Run all. At the end you'll have `https://huggingface.co/SnowyIbrahim/orion-xai-gguf`.

### 2. Create the Space (2 min)
1. huggingface.co → **New** → **Space**
2. Name: `orion-xai` · SDK: **Docker** → **Blank** · Hardware: **CPU basic (free)** · Public
3. Create. Leave it empty; GitHub fills it.

### 3. Connect GitHub to the Space (3 min)
In the GitHub repo → **Settings → Secrets and variables → Actions**:
- **Secrets** tab → New secret `HF_TOKEN` = the same write token
- **Variables** tab → New variable `HF_SPACE` = `SnowyIbrahim/orion-xai`

### 4. Deploy
Merge this branch to `main` (or run **Actions → Deploy to Hugging Face Space → Run workflow**).
Then open the Space page and watch the **Logs** tab. The first build takes 10–20 minutes.

## Optional Space secrets
Space → Settings → Variables and secrets:
- `GROQ_API_KEY`: fallback if Ollama fails
- `JWT_SECRET`, `JWT_REFRESH_SECRET`: otherwise random per restart (users get logged out on restart, which is fine for a demo)
- `ADMIN_EMAILS`: your email, to open `/admin.html`

## What to expect
- Answers stream at a few words per second (CPU only). The first reply after waking is slower.
- The Space sleeps after 48 hours without visitors and wakes on the next visit (1–2 minutes).
- Accounts and chats are wiped on every restart: free Spaces have no persistent disk.

## If the build fails
Copy the last 30 lines from the **Logs** tab and fix from there. Common causes:
- `404` downloading the GGUF: step 1 didn't finish, or the repo name differs. Set `GGUF_REPO` in the Dockerfile.
- Push rejected in the GitHub Action: the token isn't **Write**, or `HF_SPACE` is misspelled.
