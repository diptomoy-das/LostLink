# LostLink — Campus Lost & Found

A beginner-friendly full-stack starter project with:
- React + Vite frontend
- Node.js + Express backend
- Local JSON data storage
- Lost/found item reporting and browsing
- Text-based matching
- Optional Python AI service for semantic text + image similarity
- Local image uploads

## Requirements
- Node.js (LTS recommended) and npm
- Python 3.11+ (only needed for optional AI service)
- VS Code

## 1. Start the backend
Open a VS Code terminal:

```powershell
cd server
npm install
npm run dev
```

Backend: http://localhost:5000

## 2. Start the frontend
Open a SECOND VS Code terminal:

```powershell
cd client
npm install
npm run dev
```

Open the URL printed by Vite (usually http://localhost:5173).

## 3. Optional AI service (semantic text + image similarity)
Open a THIRD terminal:

```powershell
cd ai_service
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The first run downloads the Sentence Transformers and CLIP models and may take time.
The backend automatically tries the AI service at http://localhost:8000. If it is unavailable,
the app continues using its built-in text matching.

## Notes
- This is a student-project starter, not a production-ready identity or claim-verification system.
- Data is stored in `server/data/items.json`; uploads are stored in `server/uploads/`.
- Do not upload private or sensitive images.
- To reset demo data, stop the backend and empty `server/data/items.json` to `[]`.