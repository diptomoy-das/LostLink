import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import { v4 as uuid } from "uuid";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Determine data directory (Vercel serverless has read-only root, so use /tmp)
const isVercel = Boolean(process.env.VERCEL);
const DATA_DIR = isVercel
  ? path.join(os.tmpdir(), "lostlink-data")
  : path.join(__dirname, "../data");
const DB_FILE = path.join(DATA_DIR, "items.json");
const SEED_FILE = path.join(__dirname, "../data/items.json");
const UPLOAD_DIR = path.join(__dirname, "../uploads");

let memoryItems = null;

function ensureStorage() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DB_FILE)) {
      let initialData = "[]";
      if (fs.existsSync(SEED_FILE)) {
        try {
          initialData = fs.readFileSync(SEED_FILE, "utf8");
        } catch {}
      }
      fs.writeFileSync(DB_FILE, initialData);
    }
  } catch (err) {
    console.warn("Using in-memory store due to filesystem restriction:", err.message);
  }
}

function readItems() {
  if (memoryItems !== null) {
    return memoryItems;
  }
  ensureStorage();
  try {
    if (fs.existsSync(DB_FILE)) {
      memoryItems = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
      return memoryItems;
    }
  } catch {}
  try {
    if (fs.existsSync(SEED_FILE)) {
      memoryItems = JSON.parse(fs.readFileSync(SEED_FILE, "utf8"));
      return memoryItems;
    }
  } catch {}
  memoryItems = [];
  return memoryItems;
}

function writeItems(items) {
  memoryItems = items;
  try {
    ensureStorage();
    fs.writeFileSync(DB_FILE, JSON.stringify(items, null, 2));
  } catch (err) {
    console.warn("Saved to memory cache (file write skipped):", err.message);
  }
}

// Global middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));
if (fs.existsSync(UPLOAD_DIR)) {
  app.use("/uploads", express.static(UPLOAD_DIR));
}

// Multer memory storage allows serverless deployment without local disk dependency
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 }, // 4MB limit to stay within Vercel body limits
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed."));
    }
  }
});

function tokens(value = "") {
  return new Set(value.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w.length > 2));
}

function textSimilarity(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  const intersection = [...A].filter(w => B.has(w)).length;
  return intersection / new Set([...A, ...B]).size;
}

const router = express.Router();

router.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "LostLink API", vercel: isVercel });
});

router.get("/items", (req, res) => {
  const { type, q } = req.query;
  let items = [...readItems()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (type && type !== "all") {
    items = items.filter(i => i.type === type);
  }
  if (q) {
    const query = String(q).toLowerCase();
    items = items.filter(i => `${i.title} ${i.description} ${i.location} ${i.category}`.toLowerCase().includes(query));
  }
  res.json(items);
});

router.post("/items", upload.single("image"), (req, res) => {
  const { title, description, type, category, location, contact } = req.body;
  if (!title || !description || !type || !location) {
    return res.status(400).json({ error: "Title, description, type, and location are required." });
  }
  if (!["lost", "found"].includes(type)) {
    return res.status(400).json({ error: "Type must be lost or found." });
  }

  let imageDataUrl = "";
  if (req.file) {
    imageDataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
  }

  const item = {
    id: uuid(),
    title: title.trim(),
    description: description.trim(),
    type,
    category: category || "Other",
    location: location.trim(),
    contact: contact ? contact.trim() : "",
    image: imageDataUrl,
    status: "open",
    createdAt: new Date().toISOString()
  };

  const items = readItems();
  items.push(item);
  writeItems(items);
  res.status(201).json(item);
});

router.get("/items/:id/matches", async (req, res) => {
  const items = readItems();
  const source = items.find(i => i.id === req.params.id);
  if (!source) {
    return res.status(404).json({ error: "Item not found." });
  }
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
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, candidates }),
      signal: AbortSignal.timeout(1000)
    });
    if (response.ok) {
      const data = await response.json();
      matches = data.matches.map(m => ({
        item: candidates.find(c => c.id === m.id),
        score: m.score,
        method: m.method || "AI"
      })).filter(m => m.item);
    }
  } catch {
    // Optional AI service is not running; fallback to keyword matching.
  }

  matches.sort((a, b) => b.score - a.score);
  res.json(matches.slice(0, 10));
});

router.patch("/items/:id/status", (req, res) => {
  const items = readItems();
  const item = items.find(i => i.id === req.params.id);
  if (!item) {
    return res.status(404).json({ error: "Item not found." });
  }
  const { status } = req.body;
  if (!["open", "resolved"].includes(status)) {
    return res.status(400).json({ error: "Invalid status." });
  }
  item.status = status;
  writeItems(items);
  res.json(item);
});

// Mount router on both /api and / to handle different rewrite environments
app.use("/api", router);
app.use("/", router);

app.use((err, _req, res, _next) => {
  res.status(400).json({ error: err.message || "Request failed." });
});

export default app;

