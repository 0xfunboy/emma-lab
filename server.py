import os
import sys

# Ensure CUDA and cuDNN libraries are discovered
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
nvidia_dirs = [
    os.path.join(sys.prefix, 'lib/python3.12/site-packages/nvidia/cublas/lib'),
    os.path.join(sys.prefix, 'lib/python3.12/site-packages/nvidia/cudnn/lib'),
    '/home/funboy/emma-lab/lib/python3.12/site-packages/nvidia/cublas/lib',
    '/home/funboy/emma-lab/lib/python3.12/site-packages/nvidia/cudnn/lib',
    '/usr/lib/x86_64-linux-gnu'
]
curr_ld = os.environ.get('LD_LIBRARY_PATH', '')
os.environ['LD_LIBRARY_PATH'] = ':'.join([d for d in nvidia_dirs if os.path.exists(d)] + ([curr_ld] if curr_ld else []))

import json
import time
import asyncio
import logging
from typing import List, Optional, Dict, Any

from fastapi import FastAPI, Request, Response
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import numpy as np

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("emma-server")

MODEL_DIR = os.environ.get("MODEL_DIR", "/home/funboy/models/emma-6")
ONNX_PATH = os.environ.get("ONNX_PATH", os.path.join(MODEL_DIR, "emma6.onnx"))
DATA_PATH = os.environ.get("DATA_PATH", os.path.join(MODEL_DIR, "emma6.onnx.data"))
BPE_PATH = os.environ.get("BPE_PATH", os.path.join(MODEL_DIR, "bpe.model"))
EXPECTED_DATA_SIZE = int(os.environ.get("EXPECTED_DATA_SIZE", 6719807488))

app = FastAPI(title="Emma-6 Inference API")

# Global model state
sp_processor = None
ort_session = None
model_loading = False
model_ready = False

def init_tokenizer():
    global sp_processor
    try:
        import sentencepiece as spm
        if os.path.exists(BPE_PATH):
            sp = spm.SentencePieceProcessor(model_file=BPE_PATH)
            sp_processor = sp
            logger.info(f"Loaded SentencePiece tokenizer with vocab size {sp.get_piece_size()}")
    except Exception as e:
        logger.error(f"Failed to load tokenizer: {e}")

def load_onnx_model():
    global ort_session, model_ready, model_loading
    if model_ready or model_loading:
        return
    model_loading = True
    try:
        import onnxruntime as ort
        logger.info("Attempting to load ONNX model...")
        providers = ['CUDAExecutionProvider', 'CPUExecutionProvider']
        sess_options = ort.SessionOptions()
        sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        sess = ort.InferenceSession(ONNX_PATH, sess_options=sess_options, providers=providers)
        ort_session = sess
        model_ready = True
        logger.info(f"ONNX model loaded successfully on providers: {sess.get_providers()}")
    except Exception as e:
        logger.error(f"Error loading ONNX model: {e}")
    finally:
        model_loading = False

def background_model_watcher():
    import threading
    def watcher():
        while not model_ready:
            if os.path.exists(DATA_PATH):
                current_size = os.path.getsize(DATA_PATH)
                if current_size >= EXPECTED_DATA_SIZE:
                    logger.info("Model data file is complete. Loading ONNX session...")
                    load_onnx_model()
                    break
                else:
                    pct = round(current_size / EXPECTED_DATA_SIZE * 100, 1)
                    logger.info(f"Model weights downloading: {pct}% ({current_size}/{EXPECTED_DATA_SIZE})")
            time.sleep(5)
    t = threading.Thread(target=watcher, daemon=True)
    t.start()

init_tokenizer()
background_model_watcher()

# Static files mounts
FRONTEND_DIR = os.environ.get("FRONTEND_DIR", os.path.join(BASE_DIR, "frontend"))
if os.path.exists(os.path.join(FRONTEND_DIR, "static")):
    app.mount("/static", StaticFiles(directory=os.path.join(FRONTEND_DIR, "static")), name="static")
if os.path.exists(os.path.join(FRONTEND_DIR, "img")):
    app.mount("/img", StaticFiles(directory=os.path.join(FRONTEND_DIR, "img")), name="img")

@app.api_route("/", methods=["GET", "HEAD"], response_class=HTMLResponse)
async def get_index():
    index_file = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.exists(index_file):
        with open(index_file, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read(), status_code=200)
    return HTMLResponse("<h1>Emma-6 Server Running</h1>", status_code=200)

@app.get("/favicon.ico")
async def get_favicon():
    ico_path = os.path.join(FRONTEND_DIR, "img", "logo.ico")
    if os.path.exists(ico_path):
        return FileResponse(ico_path)
    return Response(status_code=404)

# API endpoints
@app.get("/api/feature-flags")
async def get_feature_flags():
    return []

@app.get("/api/feature-flags/stream")
async def get_feature_flags_stream(request: Request):
    async def event_generator():
        # Immediate keepalive comment to flush headers and signal active SSE connection
        yield ": keepalive\n\n"
        while True:
            if await request.is_disconnected():
                break
            await asyncio.sleep(15)
            yield ": keepalive\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@app.get("/api/admission/heartbeat")
@app.post("/api/admission/heartbeat")
async def admission_heartbeat():
    return {"status": "ok", "admitted": True}

@app.get("/api/ads/status")
async def ads_status():
    return {"enabled": False}

@app.get("/api/auth/google/status")
async def google_auth_status():
    return {"enabled": False}

@app.get("/api/auth/me")
async def auth_me():
    return {
        "authenticated": True,
        "first_name": "Admin",
        "last_name": "",
        "email": "selfhosted@eeess.cyou",
        "is_supporter": True,
        "is_developer": True,
        "has_active_subscription": True,
        "account_type": "personal",
        "user": {
            "first_name": "Admin",
            "firstName": "Admin",
            "last_name": "",
            "lastName": "",
            "email": "selfhosted@eeess.cyou",
            "is_supporter": True,
            "isSupporter": True,
            "is_developer": True,
            "has_active_subscription": True,
            "account_type": "personal"
        }
    }

@app.post("/api/auth/refresh")
async def auth_refresh():
    return {"access_token": "selfhosted_admin_token"}


@app.get("/api/pricing")
async def pricing():
    return {"cost_per_1k_tokens": 0.0, "currency": "EUR"}

@app.get("/api/models")
async def get_models():
    return {
        "models": [
            {
                "key": "emma-6",
                "label": "Emma-6",
                "loaded": True,
                "gqa_ratio": "4:1",
                "num_hidden_layers": 32,
                "param_label": "1,55 miliardi",
                "path": "/app/Modelli/Emma-6"
            }
        ],
        "default": "emma-6"
    }

@app.get("/api/models/info")
async def get_models_info():
    return {
        "models": [
            {
                "key": "emma-6",
                "label": "Emma-6",
                "loaded": True,
                "gqa_ratio": "4:1",
                "num_hidden_layers": 32,
                "param_label": "1,55 miliardi",
                "context_length": 4096,
                "parameter_count": 1548879872
            }
        ]
    }

@app.post("/api/models/switch")
async def switch_model(req: Request):
    return {"success": True, "model": "emma-6"}

@app.post("/api/chat/feedback")
async def chat_feedback(req: Request):
    return {"status": "ok"}

@app.post("/api/consents")
async def consents(req: Request):
    return {"status": "ok"}

@app.get("/api/chat/history/mine")
async def chat_history():
    return {"threads": []}

def sample_token(logits: np.ndarray, temperature=0.7, top_p=0.9, top_k=40) -> int:
    logits = logits.astype(np.float64)
    if temperature > 0:
        logits = logits / temperature
    else:
        return int(np.argmax(logits))
    
    # Top-k filtering
    if top_k > 0 and top_k < len(logits):
        top_k_indices = np.argpartition(logits, -top_k)[-top_k:]
        mask = np.ones(logits.shape, dtype=bool)
        mask[top_k_indices] = False
        logits[mask] = -np.inf

    # Softmax
    probs = np.exp(logits - np.max(logits))
    probs = probs / np.sum(probs)

    # Top-p (nucleus) filtering
    if top_p < 1.0:
        sorted_indices = np.argsort(probs)[::-1]
        sorted_probs = probs[sorted_indices]
        cumulative_probs = np.cumsum(sorted_probs)
        cutoff = sorted_probs[cumulative_probs > top_p]
        if len(cutoff) > 0:
            threshold = cutoff[0]
            probs[probs < threshold] = 0.0
            probs = probs / np.sum(probs)

    return int(np.random.choice(len(probs), p=probs))

def format_prompt(message: str, history: List[Dict[str, str]], preset: str = "balanced") -> tuple:
    if preset == "thinking":
        system_text = (
            "Sei Emma, un modello linguistico avanzato in lingua italiana. "
            "Fornisci risposte ampie, articolate, analitiche ed approfondite. "
            "Prima di formulare la risposta finale, esplora i passaggi logici e sviluppa un ragionamento interno analitico racchiuso tra i tag <think> e </think>. "
            "Successivamente, esponi la trattazione completa e ben strutturata."
        )
    elif preset == "creative":
        system_text = (
            "Sei Emma, un modello linguistico creativo ed espressivo in lingua italiana. "
            "Rispondi con ricchezza di linguaggio, descrizioni dettagliate, ampiezza narrativa e sfumature."
        )
    elif preset == "precise":
        system_text = (
            "Sei Emma, un modello linguistico chiaro e rigoroso in lingua italiana. "
            "Rispondi con precisione concettuale, accuratezza e spiegazioni puntuali ma complete."
        )
    else:  # balanced
        system_text = (
            "Sei Emma, un modello linguistico avanzato in lingua italiana. "
            "Rispondi in modo approfondito, ampio, chiaro ed esaustivo, fornendo spiegazioni articolate, dettagli concettuali ed esempi dove utile."
        )

    prompt_text = f"<|system|>\n{system_text}\n"
    for turn in history:
        u = turn.get("user", "").strip()
        a = turn.get("assistant", "").strip()
        if u:
            prompt_text += f"<|user|>\n{u}\n"
        if a:
            prompt_text += f"<|assistant|>\n{a}\n"

    if preset == "thinking":
        prompt_text += f"<|user|>\n{message.strip()}\n<|assistant|>\n<think>\n"
        initial_prefix = "<think>\n"
    else:
        prompt_text += f"<|user|>\n{message.strip()}\n<|assistant|>\n"
        initial_prefix = ""

    return prompt_text, initial_prefix

@app.post("/api/chat/stream")
async def chat_stream(req: Request):
    body = await req.json()
    message = body.get("message", "")
    history = body.get("history", [])
    preset = body.get("preset", "balanced")

    # Sampling parameters tuned directly on the model
    if preset == "thinking":
        temp = 0.65
        top_p = 0.92
        top_k = 40
        rep_penalty = 1.12
        min_tokens = 120
        default_max_tokens = 2048
    elif preset == "creative":
        temp = 0.85
        top_p = 0.95
        top_k = 80
        rep_penalty = 1.10
        min_tokens = 80
        default_max_tokens = 2048
    elif preset == "precise":
        temp = 0.40
        top_p = 0.80
        top_k = 20
        rep_penalty = 1.12
        min_tokens = 30
        default_max_tokens = 768
    else:  # balanced
        temp = 0.70
        top_p = 0.90
        top_k = 40
        rep_penalty = 1.10
        min_tokens = 70
        default_max_tokens = 1536

    max_tokens = int(body.get("max_new_tokens", 0))
    if max_tokens <= 0 or max_tokens == 256:  # Override old restrictive client default
        max_tokens = default_max_tokens
    max_tokens = max(min(max_tokens, 3072), 64)

    async def event_generator():
        if not model_ready or ort_session is None:
            # Model is still loading or downloading
            current_size = os.path.getsize(DATA_PATH) if os.path.exists(DATA_PATH) else 0
            pct = round(current_size / EXPECTED_DATA_SIZE * 100, 1)
            status_msg = f"Emma-6 è in fase di download/caricamento pesi ({pct}% completato). L'infrastruttura GPU RTX 3090 è pronta e risponderà a pieno regime non appena il file dei pesi ONNX sarà completo."
            for chunk in status_msg.split(" "):
                yield json.dumps({"type": "delta", "content": chunk + " "}) + "\n"
                await asyncio.sleep(0.04)
            yield json.dumps({
                "type": "done",
                "response": status_msg,
                "generation_metadata": {"tokens": len(status_msg.split())},
                "output_metadata": {}
            }) + "\n"
            return

        # Inference loop
        prompt_str, initial_prefix = format_prompt(message, history, preset=preset)
        input_ids = sp_processor.encode(prompt_str)
        curr_ids = list(input_ids)
        eos_id = 3  # </s>
        stop_token_ids = {3, 7, 8}  # </s>, <|user|>, <|assistant|>

        # Emit initial metadata with prompt token count
        yield json.dumps({
            "type": "meta",
            "model": "emma-6",
            "prompt_tokens": len(input_ids)
        }) + "\n"

        if initial_prefix:
            yield json.dumps({"type": "delta", "content": initial_prefix}) + "\n"

        generated_text = initial_prefix
        generated_tokens = []
        prefill_tok_s = 0.0
        prefill_ms = 0.0
        decode_tok_s = 0.0
        total_duration_ms = 0.0

        loop = asyncio.get_event_loop()

        try:
            # Prefill phase (evaluates the prompt)
            t_prefill_start = time.perf_counter()
            inp = np.array([curr_ids], dtype=np.int64)
            outputs = await loop.run_in_executor(None, lambda: ort_session.run(["logits"], {"input_ids": inp}))
            t_prefill_end = time.perf_counter()

            prefill_duration = max(t_prefill_end - t_prefill_start, 1e-4)
            prefill_ms = round(prefill_duration * 1000, 1)
            prefill_tok_s = round(len(input_ids) / prefill_duration, 1)

            logits = outputs[0][0, -1, :]
            t_decode_start = time.perf_counter()

            for step in range(max_tokens):
                logits_mod = logits.astype(np.float64)

                # Repetition penalty
                for prev_id in set(generated_tokens):
                    if logits_mod[prev_id] > 0:
                        logits_mod[prev_id] /= rep_penalty
                    else:
                        logits_mod[prev_id] *= rep_penalty

                # Prevent premature stop before min_tokens to guarantee articulated depth
                if step < min_tokens:
                    for sid in stop_token_ids:
                        logits_mod[sid] = -np.inf

                next_id = sample_token(logits_mod, temperature=temp, top_p=top_p, top_k=top_k)
                if (step >= min_tokens and next_id in stop_token_ids) or next_id == eos_id:
                    break

                curr_ids.append(next_id)
                generated_tokens.append(next_id)

                # Decode incrementally
                new_full = initial_prefix + sp_processor.decode(generated_tokens)
                delta = new_full[len(generated_text):]
                if delta:
                    generated_text = new_full
                    yield json.dumps({"type": "delta", "content": delta}) + "\n"

                # Advance to next token
                inp = np.array([curr_ids], dtype=np.int64)
                outputs = await loop.run_in_executor(None, lambda: ort_session.run(["logits"], {"input_ids": inp}))
                logits = outputs[0][0, -1, :]
                await asyncio.sleep(0.0005)

            t_decode_end = time.perf_counter()
            decode_duration = max(t_decode_end - t_decode_start, 1e-4)
            decode_tok_s = round(len(generated_tokens) / decode_duration, 1) if generated_tokens else 0.0
            total_duration_ms = round((t_decode_end - t_prefill_start) * 1000, 1)

        except Exception as err:
            logger.error(f"Inference error: {err}")
            yield json.dumps({"type": "delta", "content": f"\n[Errore inferenza: {err}]"}) + "\n"

        yield json.dumps({
            "type": "done",
            "response": generated_text,
            "generation_metadata": {"tokens": len(generated_tokens)},
            "output_metadata": {},
            "stats": {
                "prompt_tokens": len(input_ids),
                "output_tokens": len(generated_tokens),
                "generation_ms": total_duration_ms,
                "prefill_ms": prefill_ms,
                "prefill_tok_s": prefill_tok_s,
                "decode_tok_s": decode_tok_s,
                "temperature": temp,
                "top_p": top_p,
                "rep_penalty": rep_penalty,
                "max_tokens": max_tokens,
                "preset": preset
            }
        }) + "\n"

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")

if __name__ == "__main__":
    import uvicorn
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", 8088))
    uvicorn.run(app, host=host, port=port, log_level="info")
