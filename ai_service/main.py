from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer, util
from PIL import Image
from pathlib import Path
from urllib.parse import unquote
import os

app = FastAPI(title="LostLink AI Matching")
text_model = None
image_model = None

class MatchRequest(BaseModel):
    source: dict
    candidates: list[dict]

def load_models():
    global text_model, image_model
    if text_model is None:
        text_model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
    if image_model is None:
        from transformers import CLIPModel, CLIPProcessor
        image_model = (CLIPModel.from_pretrained("openai/clip-vit-base-patch32"),
                       CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32"))

def item_text(item):
    return " ".join(str(item.get(k, "")) for k in ("title", "description", "category"))

def image_path(item):
    rel = item.get("image", "")
    if not rel.startswith("/uploads/"):
        return None
    # Uploaded files are stored in ../server/uploads relative to this service.
    path = Path(__file__).resolve().parent.parent / "server" / "uploads" / Path(rel).name
    return path if path.exists() else None

def clip_similarity(path_a, path_b):
    if not path_a or not path_b:
        return None
    from PIL import Image
    import torch
    model, processor = image_model
    images = [Image.open(path_a).convert("RGB"), Image.open(path_b).convert("RGB")]
    inputs = processor(images=images, return_tensors="pt", padding=True)
    with torch.no_grad():
        features = model.get_image_features(**inputs)
        features = features / features.norm(dim=-1, keepdim=True)
    return float((features[0] @ features[1]).item())

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/match")
def match(request: MatchRequest):
    load_models()
    source_text = item_text(request.source)
    candidate_texts = [item_text(item) for item in request.candidates]
    text_embeddings = text_model.encode([source_text] + candidate_texts, convert_to_tensor=True, normalize_embeddings=True)
    results = []
    for index, candidate in enumerate(request.candidates, start=1):
        text_score = float(util.cos_sim(text_embeddings[0], text_embeddings[index]).item())
        img_score = clip_similarity(image_path(request.source), image_path(candidate))
        if img_score is None:
            score = max(0.0, text_score)
            method = "AI text"
        else:
            # Both similarities are normalized cosine-like scores; clamp for display.
            score = max(0.0, min(1.0, 0.6 * max(0.0, text_score) + 0.4 * max(0.0, img_score)))
            method = "AI text + image"
        results.append({"id": candidate["id"], "score": score, "method": method})
    results.sort(key=lambda row: row["score"], reverse=True)
    return {"matches": results}