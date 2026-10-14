import os
import sys
import time
import numpy as np

os.environ['LD_LIBRARY_PATH'] = '/home/funboy/emma-lab/lib/python3.12/site-packages/nvidia/cublas/lib:/home/funboy/emma-lab/lib/python3.12/site-packages/nvidia/cudnn/lib:/usr/lib/x86_64-linux-gnu'

import sentencepiece as spm
import onnxruntime as ort

MODEL_DIR = "/home/funboy/models/emma-6"
sp = spm.SentencePieceProcessor(model_file=f"{MODEL_DIR}/bpe.model")

sess_options = ort.SessionOptions()
providers = ["CUDAExecutionProvider"]
sess = ort.InferenceSession(f"{MODEL_DIR}/emma6.onnx", sess_options=sess_options, providers=providers)

system_msg = """Sei Emma, un modello linguistico italiano avanzato.
Fornisci sempre risposte approfondite, ampie, esaustive, ben articolate e ricche di dettagli.
Prima di dare la risposta finale, esplora i passaggi logici e concettuali all'interno dei tag <think> e </think>, esaminando il problema da molteplici punti di vista.
Successivamente fornisci una spiegazione completa, strutturata con paragrafi chiari ed esempi."""

test_msg = "Spiega in dettaglio la teoria della relatività ristretta e i suoi paradossi più celebri."
prompt = f"<|system|>\n{system_msg}\n<|user|>\n{test_msg}\n<|assistant|>\n<think>\n"

input_ids = sp.encode(prompt)
curr_ids = list(input_ids)
gen_tokens = []

t0 = time.time()
inp = np.array([curr_ids], dtype=np.int64)
outputs = sess.run(["logits"], {"input_ids": inp})
t1 = time.time()
prefill_time = t1 - t0
prefill_tok_s = len(input_ids) / prefill_time

logits = outputs[0][0, -1, :]
rep_penalty = 1.10
temp = 0.70
top_p = 0.90
top_k = 40
min_tokens = 150
stop_token_ids = {3, 7, 8}

t_dec_start = time.time()

for step in range(300):
    logits_mod = logits.astype(np.float64) / temp
    
    # Repetition penalty
    for pid in set(gen_tokens):
        if logits_mod[pid] > 0:
            logits_mod[pid] /= rep_penalty
        else:
            logits_mod[pid] *= rep_penalty

    # Suppress early stop before min_tokens
    if step < min_tokens:
        for sid in stop_token_ids:
            logits_mod[sid] = -np.inf

    # Top-k
    if top_k > 0 and top_k < len(logits_mod):
        top_k_indices = np.argpartition(logits_mod, -top_k)[-top_k:]
        mask = np.ones(logits_mod.shape, dtype=bool)
        mask[top_k_indices] = False
        logits_mod[mask] = -np.inf

    probs = np.exp(logits_mod - np.max(logits_mod))
    probs = probs / np.sum(probs)

    # Top-p
    if top_p < 1.0:
        sorted_indices = np.argsort(probs)[::-1]
        sorted_probs = probs[sorted_indices]
        cumulative_probs = np.cumsum(sorted_probs)
        cutoff = sorted_probs[cumulative_probs > top_p]
        if len(cutoff) > 0:
            probs[probs < cutoff[0]] = 0.0
            probs = probs / np.sum(probs)

    next_id = int(np.random.choice(len(probs), p=probs))

    if step >= min_tokens and next_id in stop_token_ids:
        break

    curr_ids.append(next_id)
    gen_tokens.append(next_id)
    inp = np.array([curr_ids], dtype=np.int64)
    outputs = sess.run(["logits"], {"input_ids": inp})
    logits = outputs[0][0, -1, :]

t_dec_end = time.time()
decode_time = t_dec_end - t_dec_start
decode_tok_s = len(gen_tokens) / decode_time if decode_time > 0 else 0

out_text = sp.decode(gen_tokens)
print(f"PREFILL: {len(input_ids)} tok, {prefill_time:.4f}s, {prefill_tok_s:.1f} tok/s", flush=True)
print(f"DECODE: {len(gen_tokens)} tok, {decode_time:.4f}s, {decode_tok_s:.1f} tok/s", flush=True)
print("=== GENERATED TEXT ===", flush=True)
print("<think>\n" + out_text, flush=True)
