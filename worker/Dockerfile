# SwingSight CV worker — Cloud Run container (linux/amd64, matching Cloud Run).
FROM python:3.12-slim

# System libs:
#  - ffmpeg: the playback transcode (subprocess) + ffprobe.
#  - libgl1/libglib2.0-0/libsm6/libxext6/libxrender1: opencv-contrib-python (pulled by
#    mediapipe) is the non-headless build and links these at import.
#  - curl/ca-certificates: fetch the BlazePose .task model at build time.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    libgles2 \
    libegl1 \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    POSE_MODEL_DIR=/app/models

WORKDIR /app

COPY pyproject.toml ./
COPY src ./src
RUN pip install --upgrade pip && pip install .

# Bundle the BlazePose Tasks model (no network at runtime, deterministic).
RUN mkdir -p /app/models && \
    curl -fsSL -o /app/models/pose_landmarker_full.task \
    https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task

# Cloud Run injects PORT (default 8080).
ENV PORT=8080
EXPOSE 8080

CMD ["sh", "-c", "uvicorn swingsight_worker.main:app --host 0.0.0.0 --port ${PORT}"]
