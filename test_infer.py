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
sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
sess = ort.InferenceSession(f"{MODEL_DIR}/emma6.onnx", sess_options=sess_options, providers=providers)
print(f"Providers active: {sess.get_providers()}")

test_msg = "Spiegami la teoria della relatività ristretta e i suoi paradossi principali in dettaglio."
prompt = f"<|system|>\nSei un assistente AI avanzato. Fornisci risposte approfondite, dettagliate, ricche di particolari ed articolate. Prima di rispondere ragiona attentamente passo dopo passo inserendo le tue riflessioni tra i tag <think> e </think>, poi fornisci la spiegazione completa.\n<|user|>\n{test_msg}\n<|assistant|>\n<think>\n"

input_ids = sp.encode(prompt)
print(f"Prompt tokens: {len(input_ids)}")

t0 = time.time()
inp = np.array([input_ids], dtype=np.int64)
outputs = sess.run(["logits"], {"input_ids": inp})
t1 = time.time()
prefill_time = t1 - t0
prefill_tok_s = len(input_ids) / prefill_time
print(f"Prefill time: {prefill_time:.4f}s ({prefill_tok_s:.2f} tok/s)")

logits = outputs[0][0, -1, :]
curr_ids = list(input_ids)
gen_tokens = []
t_dec_start = time.time()

for step in range(150):
    logits = logits.astype(np.float64) / 0.7
    top_k = 40
    top_k_indices = np.argpartition(logits, -top_k)[-top_k:]
    mask = np.ones(logits.shape, dtype=bool)
    mask[top_k_indices] = False
    logits[mask] = -np.inf
    probs = np.exp(logits - np.max(logits))
    probs = probs / np.sum(probs)
    next_id = int(np.random.choice(len(probs), p=probs))
    
    if next_id in (3, 7, 8):
        break
    curr_ids.append(next_id)
    gen_tokens.append(next_id)
    inp = np.array([curr_ids], dtype=np.int64)
    out = sess.run(["logits"], {"input_ids": inp})
    logits = out[0][0, -1, :]

t_dec_end = time.time()
dec_time = t_dec_end - t_dec_start
dec_tok_s = len(gen_tokens) / dec_time if dec_time > 0 else 0
print(f"Decode tokens: {len(gen_tokens)} in {dec_time:.4f}s ({dec_tok_s:.2f} tok/s)")
print("Generated text:\n", sp.decode(gen_tokens))
