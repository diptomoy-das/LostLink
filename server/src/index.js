import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { v4 as uuid } from "uuid";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 5000;
const DATA_DIR = path.join(__dirname, "../data");
const UPLOAD_DIR = path.join(__dirname, "../uploads");
const DB_FILE = path.join(DATA_DIR, "items.json");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, "[]");

app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());
app.use("/uploads", express.static(UPLOAD_DIR));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safeExt = path.extname(file.originalname).toLowerCase().slice(0, 10);
    cb(null, `${Date.now()}-${uuid()}${safeExt}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed."));
  }
});

const readItems = () => JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
const writeItems = (items) => fs.writeFileSync(DB_FILE, JSON.stringify(items, null, 2));

function tokens(value = "") {
  return new Set(value.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w.length > 2));
}
function textSimilarity(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  const intersection = [...A].filter(w => B.has(w)).length;
  return intersection / new Set([...A, ...B]).size;
}

app.get("/api/health", (_req, res) => res.json({ status: "ok", service: "LostLink API" }));

app.get("/api/items", (req, res) => {
  const { type, q } = req.query;
  let items = readItems().sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (type && type !== "all") items = items.filter(i => i.type === type);
  if (q) {
    const query = String(q).toLowerCase();
    items = items.filter(i => `${i.title} ${i.description} ${i.location} ${i.category}`.toLowerCase().includes(query));
  }
  res.json(items);
});

app.post("/api/items", upload.single("image"), (req, res) => {
  const { title, description, type, category, location, contact } = req.body;
  if (!title || !description || !type || !location) {
    return res.status(400).json({ error: "Title, description, type, and location are required." });
  }
  if (!["lost", "found"].includes(type)) return res.status(400).json({ error: "Type must be lost or found." });
  const item = {
    id: uuid(), title: title.trim(), description: description.trim(),
    type, category: category || "Other", location: location.trim(),
    contact: contact || "", image: req.file ? `/uploads/${req.file.filename}` : "",
    status: "open", createdAt: new Date().toISOString()
  };
  const items = readItems();
  items.push(item);
  writeItems(items);
  res.status(201).json(item);
});

app.get("/api/items/:id/matches", async (req, res) => {
  const items = readItems();
  const source = items.find(i => i.id === req.params.id);
  if (!source) return res.status(404).json({ error: "Item not found." });
  const candidates = items.filter(i => i.id !== source.id && i.type !== source.type && i.status === "open");
  let matches = candidates.map(item => ({
    item,
    score: textSimilarity(
      `${source.title} ${source.description} ${source.category}`,
      `${item.title} ${item.description} ${item.category}`
    ),
    method: "keyword"
  }));
  try {
    const response = await fetch("http://127.0.0.1:8000/match", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, candidates })
    });
    if (response.ok) {
      const data = await response.json();
      matches = data.matches.map(m => ({
        item: candidates.find(c => c.id === m.id),
        score: m.score, method: m.method || "AI"
      })).filter(m => m.item);
    }
  } catch { /* Optional AI service is not running; use keyword matching. */ }
  matches.sort((a,b) => b.score - a.score);
  res.json(matches.slice(0, 10));
});

app.patch("/api/items/:id/status", (req, res) => {
  const items = readItems();
  const item = items.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Item not found." });
  const { status } = req.body;
  if (!["open", "resolved"].includes(status)) return res.status(400).json({ error: "Invalid status." });
  item.status = status;
  writeItems(items);
  res.json(item);
});

app.use((err, _req, res, _next) => {
  res.status(400).json({ error: err.message || "Request failed." });
});

app.listen(PORT, () => console.log(`LostLink API running at http://localhost:${PORT}`));