# 🧪 Emma 6 Lab — Documentazione Ufficiale (Italiano)

> **«Contenuto generato da Emma6, contiene sicuramente errori»**  
> *— Il disclaimer più onesto nella storia dell'intelligenza artificiale.*

---

## 📌 1. Che cos'è Emma 6 Lab?

**Emma 6 Lab** è un progetto sperimentale, satirico e **creato al 100% FOR FUN** ideato da [@0xfunboy](https://x.com/funB0Tnft).

L'obiettivo del progetto è stato quello di prendere il modello italiano open-source **Emma-6 (1.55 Miliardi di parametri)** rilasciato su Hugging Face da Egomnia S.p.A., deployarlo su un server bare-metal privato con hardware da competizione (**NVIDIA GeForce RTX 3090 24GB VRAM**, **128GB RAM**, **Intel Core i5-13500** su motore **ONNX Runtime CUDA**), rimuovere tutti i tracker, la burocrazia aziendale, la P.IVA e i paywall dell'interfaccia originale, e testare sul campo quanto in basso possa spingersi l'asticella dell'intelletto sintetico.

### 🪨 Il Verdetto Clinico: Perché l'AI fa schifo ed è stupida come una roccia

Non usiamo mezzi termini: **Emma-6 è stupida come un ciottolo di fiume**.

Nonostante i proclami di "sovranità tecnologica" e le architetture moderne sbandierate nei paper (Transformer decoder-only, GQA, SwiGLU, RMSNorm), il modello nella pratica dimostra abilità cognitive paragonabili a quelle di un tostapane vintage:

1. **Allucinazioni ad altissimo voltaggio**: Se le chiedi chi ha scritto la Divina Commedia, rischia di ringraziarti per aver visitato il suo profilo aziendale o di inventarsi date storiche ambientate nel 2048.
2. **Attenzione da pesce rosso**: Se lasciata ai parametri predefiniti di fabbrica, la sua finestra di ragionamento utile dura circa 15-20 token. Dopo di che, o interrompe la frase a metà verbo o sputa risposte di 3 parole tipo *"Sì, il futuro."*
3. **Sintassi italiana dadaista**: Spesso unisce parole casualmente, inventa neologismi che nessun accademico della Crusca ha mai concepito, spezza gli elenchi puntati a metà o fa crollare l'output in un loop infinito della stessa congiunzione.
4. **Disconnessione dalla realtà**: Non possiede alcuna capacità di deduzione logica o matematica, ed è totalmente priva di filtri di coerenza.

---

## 📥 2. Download del Modello e Pesi Ufficiali

Il modello originale Emma-6 è distribuito pubblicamente su Hugging Face:
- **Repository Hugging Face**: [https://huggingface.co/egomnia/emma-6](https://huggingface.co/egomnia/emma-6)

### File necessari per l'inferenza ONNX CUDA:

| File | Dimensione | Descrizione |
|---|---|---|
| [`emma6.onnx`](https://huggingface.co/egomnia/emma-6/resolve/main/emma6.onnx) | ~1.85 MB | Grafo di calcolo ONNX della rete neurale |
| [`emma6.onnx.data`](https://huggingface.co/egomnia/emma-6/resolve/main/emma6.onnx.data) | ~6.72 GB | Pesi quantizzati in virgola mobile FP16 (6.719.807.488 bytes) |
| [`bpe.model`](https://huggingface.co/egomnia/emma-6/resolve/main/bpe.model) | ~1.30 MB | Modello del tokenizer SentencePiece (Vocabolario di 64.000 token) |
| [`config.json`](https://huggingface.co/egomnia/emma-6/resolve/main/config.json) | ~488 B | Configurazione dell'architettura (GQA 4:1, 32 layers, hidden 2048) |

### Download rapido via riga di comando:
```bash
mkdir -p /home/funboy/models/emma-6
cd /home/funboy/models/emma-6

# Scarica il grafo e la configurazione
curl -L -O https://huggingface.co/egomnia/emma-6/resolve/main/config.json
curl -L -O https://huggingface.co/egomnia/emma-6/resolve/main/bpe.model
curl -L -O https://huggingface.co/egomnia/emma-6/resolve/main/bpe.vocab
curl -L -O https://huggingface.co/egomnia/emma-6/resolve/main/emma6.onnx

# Scarica il file gigante dei pesi (6.72 GB)
curl -L -O https://huggingface.co/egomnia/emma-6/resolve/main/emma6.onnx.data
```

---

## 🛠️ 3. Le Soluzioni Adottate: Come abbiamo cercato di renderla più intelligente

Di fronte a un modello che rispondeva a monosillabi e collassava al secondo turno di chat, abbiamo sviluppato un'intera suite di interventi ingegneristici estremi:

### 1. 🧠 La modalità "Thinking" forzata (Prompt Inception)
I modelli moderni (come DeepSeek-R1 o o1) usano tag `<think>` per ragionare internamente. Emma-6 **non ha nativamente alcuna nozione di thinking**.
Abbiamo quindi inventato un trucco a livello di inferenza nel server (`server.py`):
- Il system prompt viene iniettato con l'ordine perentorio di simulare un soliloquio interno.
- Nel prompt finale inviato al modello, forziamo il turno dell'assistente pre-compilando l'inizio con:
  ```text
  <|user|>
  Cos'è il futuro?
  <|assistant|>
  <think>
  ```
- Trovandosi già dentro il tag `<think>`, Emma-6 è **costretta per continuazione probabilistica** a sproloquiare riflessioni prima di chiudere con `</think>` e dare la risposta finale!
- Nel frontend, un parser individua il blocco `<think>` e lo trasforma in un box stilizzato con l'emote del cervello **🧠 Ragionamento**, completo di pulsante toggle con LED neon verde nel footer hardware.

### 2. 🎛️ Chirurgia dei Parametri di Sampling
I preset standard del client troncano a 256 token con campionamento grezzo. Abbiamo implementato nel server un override dei parametri:
- **`min_tokens: 120`**: Impedisce a Emma-6 di generare il token di stop prima di aver scritto almeno 120 token. Se prova a terminare prima, la probabilità dei token `<|user|>`, `<|assistant|>` e `</s>` viene forzata a `-inf`.
- **`repetition_penalty: 1.10 - 1.12`**: Penalizza la ripetizione stocastica ciclica delle stesse parole italiane.
- **`top_k: 40` & `top_p: 0.90`**: Filtro probabilistico che elimina le parole completamente deliranti dalla coda della distribuzione.
- **`temperature: 0.65 - 0.70`**: Abbassa la creatività psichedelica rendendola lievemente più ancorata a una logica coerente.

### 3. 🩹 Motore di Riparazione Markdown in Tempo Reale (`chat_renderer.js`)
Emma-6 durante lo streaming spezzetta il testo in modo imprevedibile:
- Appiccica i titoli di intestazione al testo (`## Cos'è il futuroLa vita è...`).
- Separa i trattini degli elenchi puntati mandando a capo i caratteri (`- ` a vuoto).
- Tronca tabelle e blocchi di codice.

Abbiamo implementato una pipeline di normalizzazione on-the-fly (`maskInlineCode`, `reflowHeadings`, `reflowLists`, `reflowTable`) che intercetta i frammenti dello stream SSE e ricompone un Markdown impeccabile prima che tocchi il DOM.

### 4. ⚡ Accelerazione Hardware Bare-Metal ONNX CUDA
Nonostante il basso QI del modello, l'infrastruttura sottostante è un mostro di velocità:
- Esecuzione su **NVIDIA GeForce RTX 3090 24GB** con `CUDAExecutionProvider`.
- Velocità di **prefill: ~700 token/s**.
- Velocità di **decode: ~40 token/s**.
- Telemetria live esposta nel frontend sopra l'input box: token del prompt, token generati, velocità di decodifica e tempo di generazione al millisecondo.

### 5. 🎨 Frontend De-Corporatizzato & Dark Mode Cyberpunk
L'interfaccia originale è stata ripulita da:
- Cookie banner bloccanti, richieste di login e P.IVA.
- Modali promozionali e tracciamenti analytics.
- Bug dei titoli invisibili in Dark Mode: in modalità scura, i titoli (`.md-heading`) avevano colore `#16241f` identico allo sfondo `#151e1d`. Li abbiamo forzati a `#ffffff !important` con `font-weight: 800`.
- Aggiunto il tasto diretto verso il profilo X di [@funB0Tnft](https://x.com/funB0Tnft).

---

## 🚀 4. Installazione e Avvio Locale

### Requisiti
- Linux (Ubuntu 22.04 / 24.04 consigliato)
- Python 3.10+ (consigliato 3.12 con `uv`)
- Driver NVIDIA + CUDA 12.x
- Circa 10 GB di spazio su disco per i pesi

### Passaggi:

```bash
# 1. Clona il repository
git clone https://github.com/0xfunboy/emma-lab.git
cd emma-lab

# 2. Crea l'ambiente virtuale
uv venv .venv
source .venv/bin/activate

# 3. Installa le dipendenze
uv pip install -r requirements.txt

# 4. Imposta il percorso del modello (se diverso da /home/funboy/models/emma-6)
export MODEL_DIR="/percorso/ai/tuoi/pesi/emma-6"

# 5. Avvia il server FastAPI
python server.py
```

Il frontend sarà accessibile istantaneamente su `http://127.0.0.1:8088`.

---

## ⚖️ Licenza & Disclaimer

- Il codice sorgente del server e del frontend di questo repository è rilasciato sotto licenza **MIT**.
- I pesi del modello Emma-6 sono distribuiti da Egomnia S.p.A. sotto licenza **OpenRAIL**.
- Questo progetto è una **parodia tecnica / esperimento satirico per fini di ricerca e intrattenimento**. Nessun intento diffamatorio: i dati e le risposte del modello parlano da soli.
