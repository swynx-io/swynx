# Swynx AI Fine-tuning on Gaming PC

Your RTX 4070 (12GB VRAM) will train the model in ~15-20 minutes without crashing.

## Prerequisites

- Windows with WSL2, or Linux
- NVIDIA drivers installed
- Python 3.10+

## Steps

### 1. Clone the repo

```bash
git clone https://github.com/swynx-io/swynx.git
cd swynx
```

### 2. Check training data exists

```bash
ls -la results/finetune-data.jsonl
```

Should show ~45,000 lines. If missing, copy from Mac or regenerate:
```bash
node src/ai/export-finetune-data.mjs
```

### 3. Run fine-tuning

```bash
./scripts/finetune-nvidia.sh
```

This will:
- Create a Python venv
- Install PyTorch + CUDA + training libs
- Fine-tune Qwen2.5-Coder-3B with LoRA
- Save to `swynx-finetuned/`

### 4. Copy model back to Mac

The merged model will be in `swynx-finetuned/merged/`. Copy this folder to your Mac.

Then on Mac:
```bash
cd swynx-finetuned/merged
ollama create swynx-deadcode -f Modelfile
```

## Troubleshooting

**CUDA not found**: Install NVIDIA drivers and reboot

**Out of memory**: Reduce batch size:
```bash
python3 src/ai/finetune-nvidia.py --batch-size 2
```

**Permission denied on script**:
```bash
chmod +x scripts/finetune-nvidia.sh
```
