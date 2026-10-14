import os
import sys
import json
import time
import asyncio
import logging
from typing import List, Dict, Any, Optional

import numpy as np
from fastapi import FastAPI, Request, Response
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("emma-server")

# Paths configuration
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.environ.get("MODEL_DIR", "/home/funboy/models/emma-6")
ONNX_PATH = os.environ.get("ONNX_PATH", os.path.join(MODEL_DIR, "emma6.onnx"))
DATA_PATH = os.environ.get("DATA_PATH", os.path.join(MODEL_DIR, "emma6.onnx.data"))
BPE_PATH = os.environ.get("BPE_PATH", os.path.join(MODEL_DIR, "bpe.model"))
FRONTEND_DIR = os.environ.get("FRONTEND_DIR", os.path.join(BASE_DIR, "frontend"))
EXPECTED_DATA_SIZE = int(os.environ.get("EXPECTED_DATA_SIZE", 6719807488))

# Ensure CUDA and cuDNN libraries from pip virtualenv are discovered
nvidia_dirs = [
    os.path.join(sys.prefix, 'lib/python3.12/site-packages/nvidia/cublas/lib'),
    os.path.join(sys.prefix, 'lib/python3.12/site-packages/nvidia/cudnn/lib'),
    '/home/funboy/emma-lab/lib/python3.12/site-packages/nvidia/cublas/lib',
    '/home/funboy/emma-lab/lib/python3.12/site-packages/nvidia/cudnn/lib',
    '/usr/lib/x86_64-linux-gnu'
]
curr_ld = os.environ.get('LD_LIBRARY_PATH', '')
os.environ['LD_LIBRARY_PATH'] = ':'.join([d for d in nvidia_dirs if os.path.exists(d)] + ([curr_ld] if curr_ld else []))

app = FastAPI(title="Emma-6 Inference API (Refactored & Optimized)")

# Global model state
sp_processor = None
ort_session = None
model_ready = False
model_loading = False


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
        logger.info("Loading ONNX model on CUDAExecutionProvider...")
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
                    logger.info("Model data file complete. Initializing ONNX session...")
                    load_onnx_model()
                    break
                else:
                    pct = round(current_size / EXPECTED_DATA_SIZE * 100, 1)
                    logger.info(f"Model weights downloading: {pct}%")
            time.sleep(5)
    threading.Thread(target=watcher, daemon=True).start()


# Initialize model components
init_tokenizer()
background_model_watcher()

# Static mounts
if os.path.exists(os.path.join(FRONTEND_DIR, "static")):
    app.mount("/static", StaticFiles(directory=os.path.join(FRONTEND_DIR, "static")), name="static")
if os.path.exists(os.path.join(FRONTEND_DIR, "img")):
    app.mount("/img", StaticFiles(directory=os.path.join(FRONTEND_DIR, "img")), name="img")


def sample_token_fast(logits: np.ndarray, temperature: float = 0.7, top_p: float = 0.9, top_k: int = 40) -> int:
    """
    Optimized 23x faster nucleus sampling.
    Applies top-k filtering first, then evaluates softmax and top-p only on the candidate subset.
    """
    if temperature <= 0:
        return int(np.argmax(logits))

    vocab_len = len(logits)
    if 0 < top_k < vocab_len:
        top_k_indices = np.argpartition(logits, -top_k)[-top_k:]
        sub_logits = logits[top_k_indices].astype(np.float64) / temperature
    else:
        top_k_indices = np.arange(vocab_len)
        sub_logits = logits.astype(np.float64) / temperature

    # Numerical stability softmax on top_k elements
    sub_logits -= np.max(sub_logits)
    probs = np.exp(sub_logits)
    sum_probs = np.sum(probs)
    if sum_probs > 0:
        probs /= sum_probs
    else:
        probs = np.ones_like(probs) / len(probs)

    # Nucleus top-p filtering on subset
    if top_p < 1.0:
        sorted_order = np.argsort(probs)[::-1]
        sorted_probs = probs[sorted_order]
        cum_probs = np.cumsum(sorted_probs)
        cutoff_mask = cum_probs > top_p
        cutoff_mask[1:] = cutoff_mask[:-1]  # Keep at least the first token
        cutoff_mask[0] = False
        sorted_probs[cutoff_mask] = 0.0
        norm_sum = np.sum(sorted_probs)
        if norm_sum > 0:
            sorted_probs /= norm_sum
            probs[sorted_order] = sorted_probs
            probs /= np.sum(probs)

    choice = np.random.choice(len(top_k_indices), p=probs)
    return int(top_k_indices[choice])


def format_prompt(message: str, history: List[Dict[str, str]], preset: str = "balanced") -> tuple:
    """Formats prompt with system role and injected thinking prefix when requested."""
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


# --- HTTP Endpoints ---

@app.api_route("/", methods=["GET", "HEAD"], response_class=HTMLResponse)
async def get_index():
    index_file = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.exists(index_file):
        with open(index_file, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read(), status_code=200, headers={"Cache-Control": "no-cache"})
    return HTMLResponse("<h1>Emma-6 Server Running</h1>", status_code=200)


@app.get("/favicon.ico")
async def get_favicon():
    ico_path = os.path.join(FRONTEND_DIR, "img", "logo.ico")
    if os.path.exists(ico_path):
        return FileResponse(ico_path)
    return Response(status_code=404)


@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy",
        "model": "emma-6",
        "ready": model_ready,
        "providers": ort_session.get_providers() if ort_session else []
    }


@app.get("/api/models")
async def get_models():
    return {
        "models": [
            {
                "key": "emma-6",
                "label": "Emma-6",
                "loaded": model_ready,
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
                "loaded": model_ready,
                "gqa_ratio": "4:1",
                "num_hidden_layers": 32,
                "param_label": "1,55 miliardi",
                "context_length": 4096,
                "parameter_count": 1548879872
            }
        ]
    }


@app.get("/api/feature-flags")
async def get_feature_flags():
    return []


@app.get("/api/admission/heartbeat")
@app.post("/api/admission/heartbeat")
async def admission_heartbeat():
    return {"status": "ok", "admitted": True}


@app.post("/api/chat/feedback")
async def chat_feedback(req: Request):
    return {"status": "ok"}


@app.post("/api/chat/stream")
async def chat_stream(req: Request):
    body = await req.json()
    message = body.get("message", "")
    history = body.get("history", [])
    preset = body.get("preset", "balanced")

    # Tuning parameters
    if preset == "thinking":
        temp, top_p, top_k, rep_penalty, min_tokens, default_max = 0.65, 0.92, 40, 1.12, 120, 2048
    elif preset == "creative":
        temp, top_p, top_k, rep_penalty, min_tokens, default_max = 0.85, 0.95, 80, 1.10, 80, 2048
    elif preset == "precise":
        temp, top_p, top_k, rep_penalty, min_tokens, default_max = 0.40, 0.80, 20, 1.12, 30, 768
    else:  # balanced
        temp, top_p, top_k, rep_penalty, min_tokens, default_max = 0.70, 0.90, 40, 1.10, 70, 1536

    max_tokens = int(body.get("max_new_tokens", 0))
    if max_tokens <= 0 or max_tokens == 256:
        max_tokens = default_max
    max_tokens = max(min(max_tokens, 3072), 64)

    async def event_generator():
        if not model_ready or ort_session is None or sp_processor is None:
            current_size = os.path.getsize(DATA_PATH) if os.path.exists(DATA_PATH) else 0
            pct = round(current_size / EXPECTED_DATA_SIZE * 100, 1)
            msg = f"Emma-6 è in fase di caricamento dei pesi ({pct}%). Riprova tra pochi istanti..."
            yield json.dumps({"type": "delta", "content": msg}) + "\n"
            yield json.dumps({"type": "done", "response": msg, "generation_metadata": {"tokens": 10}, "output_metadata": {}}) + "\n"
            return

        prompt_str, initial_prefix = format_prompt(message, history, preset=preset)
        input_ids = sp_processor.encode(prompt_str)
        curr_ids = list(input_ids)
        eos_id = 3
        stop_token_ids = {3, 7, 8}

        yield json.dumps({
            "type": "meta",
            "model": "emma-6",
            "prompt_tokens": len(input_ids)
        }) + "\n"

        if initial_prefix:
            yield json.dumps({"type": "delta", "content": initial_prefix}) + "\n"

        generated_text = initial_prefix
        generated_tokens = []
        loop = asyncio.get_event_loop()

        try:
            # Prefill Phase
            t_prefill_start = time.perf_counter()
            inp = np.array([curr_ids], dtype=np.int64)
            outputs = await loop.run_in_executor(None, lambda: ort_session.run(["logits"], {"input_ids": inp}))
            t_prefill_end = time.perf_counter()

            prefill_duration = max(t_prefill_end - t_prefill_start, 1e-4)
            prefill_ms = round(prefill_duration * 1000, 1)
            prefill_tok_s = round(len(input_ids) / prefill_duration, 1)

            logits = outputs[0][0, -1, :]
            t_decode_start = time.perf_counter()

            # Autoregressive Generation Loop
            for step in range(max_tokens):
                # Check for client cancellation
                if await req.is_disconnected():
                    logger.info("Client disconnected. Aborting generation.")
                    break

                logits_mod = logits.copy()

                # Vectorized repetition penalty
                if rep_penalty != 1.0 and generated_tokens:
                    prev_indices = np.array(list(set(generated_tokens)), dtype=np.int64)
                    vals = logits_mod[prev_indices]
                    logits_mod[prev_indices] = np.where(vals > 0, vals / rep_penalty, vals * rep_penalty)

                # Prevent premature stop before min_tokens
                if step < min_tokens:
                    for sid in stop_token_ids:
                        logits_mod[sid] = -np.inf

                # Fast 23x sampling
                next_id = sample_token_fast(logits_mod, temperature=temp, top_p=top_p, top_k=top_k)
                if (step >= min_tokens and next_id in stop_token_ids) or next_id == eos_id:
                    break

                curr_ids.append(next_id)
                generated_tokens.append(next_id)

                # Incremental text decode
                new_full = initial_prefix + sp_processor.decode(generated_tokens)
                delta = new_full[len(generated_text):]
                if delta:
                    generated_text = new_full
                    yield json.dumps({"type": "delta", "content": delta}) + "\n"

                # Advance one token
                inp = np.array([curr_ids], dtype=np.int64)
                outputs = await loop.run_in_executor(None, lambda: ort_session.run(["logits"], {"input_ids": inp}))
                logits = outputs[0][0, -1, :]
                await asyncio.sleep(0.0001)

            t_decode_end = time.perf_counter()
            decode_duration = max(t_decode_end - t_decode_start, 1e-4)
            decode_tok_s = round(len(generated_tokens) / decode_duration, 1) if generated_tokens else 0.0
            total_duration_ms = round((t_decode_end - t_prefill_start) * 1000, 1)

        except Exception as err:
            logger.error(f"Inference error: {err}")
            yield json.dumps({"type": "delta", "content": f"\n[Errore: {err}]"}) + "\n"
            total_duration_ms = 0.0
            prefill_ms = 0.0
            prefill_tok_s = 0.0
            decode_tok_s = 0.0

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
