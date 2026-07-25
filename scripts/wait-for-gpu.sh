#!/bin/bash
set -u

for i in $(seq 1 30); do
    if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
        echo "NVIDIA GPU detected"
        exit 0
    fi

    if command -v rocm-smi >/dev/null 2>&1 && rocm-smi --showid >/dev/null 2>&1; then
        echo "AMD GPU detected via rocm-smi"
        exit 0
    fi

    if ls /sys/class/drm 2>/dev/null | grep -q '^card[0-9]\+$'; then
        echo "GPU detected via /sys/class/drm"
        exit 0
    fi

    sleep 1
done

echo "No GPUs detected (NVIDIA or AMD) after 30s" >&2
exit 1
