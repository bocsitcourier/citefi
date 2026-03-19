# VeoMagic - AI Video Generation System
## Complete Setup & Deployment Guide

---

## 🚀 Overview

VeoMagic is a complete solution for generating professional 60-second videos from brief ideas using:
- **AI Script Generation**: Expands your brief idea into a full narrative
- **Veo AI Integration**: Generates 8-second video segments
- **Automatic Stitching**: Creates seamless 60-second final video
- **Brand Integration**: Adds your logo, website, and call-to-action

---

## 📋 System Requirements

### Software Requirements
- Python 3.9+
- Node.js 16+
- FFmpeg 4.0+
- OpenCV (cv2)
- 8GB RAM minimum (16GB recommended)
- GPU recommended for faster processing

### API Keys Required
- OpenAI API Key (GPT-4 access)
- Veo AI API Key
- Optional: AWS S3 for storage

---

## 🛠️ Installation

### 1. Clone and Setup

```bash
# Create project directory
mkdir veomagic
cd veomagic

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install Python dependencies
pip install -r requirements.txt

# Install FFmpeg
# Ubuntu/Debian
sudo apt update
sudo apt install ffmpeg

# macOS
brew install ffmpeg

# Windows
# Download from https://ffmpeg.org/download.html
```

### 2. Requirements File

Create `requirements.txt`:

```txt
flask==2.3.0
flask-cors==4.0.0
openai==1.0.0
aiohttp==3.8.5
pillow==10.0.0
opencv-python==4.8.0
numpy==1.24.0
python-dotenv==1.0.0
gunicorn==21.2.0
redis==5.0.0
celery==5.3.0
boto3==1.28.0
```

### 3. Environment Configuration

Create `.env` file:

```bash
# API Keys
OPENAI_API_KEY=sk-your-openai-key
VEO_API_KEY=your-veo-api-key
VEO_API_URL=https://api.veo.ai/v1/generate

# Server Configuration
FLASK_ENV=production
SECRET_KEY=your-secret-key-here
SERVER_HOST=0.0.0.0
SERVER_PORT=5000

# Storage
UPLOAD_FOLDER=./uploads
OUTPUT_FOLDER=./generated_videos
MAX_CONTENT_LENGTH=100MB

# Redis (for async processing)
REDIS_URL=redis://localhost:6379/0

# Optional: AWS S3
AWS_ACCESS_KEY_ID=your-aws-key
AWS_SECRET_ACCESS_KEY=your-aws-secret
S3_BUCKET=veomagic-videos
S3_REGION=us-east-1

# Optional: Database
DATABASE_URL=postgresql://user:password@localhost/veomagic
```

---

## 🚀 Deployment Options

### Option 1: Local Development

```bash
# Start backend
python veo_backend_service.py

# Serve frontend (in another terminal)
python -m http.server 8000

# Access at http://localhost:8000/veo_video_creator_app.html
```

### Option 2: Production with Docker

Create `Dockerfile`:

```dockerfile
FROM python:3.9-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY . .

# Create necessary directories
RUN mkdir -p uploads generated_videos segments temp

EXPOSE 5000

CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "4", "--timeout", "300", "veo_backend_service:app"]
```

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  web:
    build: .
    ports:
      - "5000:5000"
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - VEO_API_KEY=${VEO_API_KEY}
    volumes:
      - ./generated_videos:/app/generated_videos
      - ./uploads:/app/uploads
    depends_on:
      - redis

  redis:
    image: redis:alpine
    ports:
      - "6379:6379"

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./veo_video_creator_app.html:/usr/share/nginx/html/index.html
      - ./ssl:/etc/nginx/ssl
    depends_on:
      - web
```

### Option 3: Cloud Deployment (AWS)

```bash
# Install AWS CLI
pip install awscli

# Configure AWS
aws configure

# Deploy with Elastic Beanstalk
eb init -p python-3.9 veomagic
eb create veomagic-production
eb deploy

# Or use EC2 with systemd service
sudo nano /etc/systemd/system/veomagic.service
```

`veomagic.service`:

```ini
[Unit]
Description=VeoMagic Video Generation Service
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/veomagic
Environment="PATH=/home/ubuntu/veomagic/venv/bin"
ExecStart=/home/ubuntu/veomagic/venv/bin/gunicorn --workers 4 --bind unix:veomagic.sock veo_backend_service:app

[Install]
WantedBy=multi-user.target
```

---

## 🔧 Configuration

### Nginx Configuration

Create `nginx.conf`:

```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    client_max_body_size 100M;
    
    location / {
        root /usr/share/nginx/html;
        try_files $uri $uri/ /index.html;
    }
    
    location /api {
        proxy_pass http://web:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }
    
    location /generated_videos {
        alias /app/generated_videos;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

### SSL Setup (Production)

```bash
# Install Certbot
sudo apt-get install certbot python3-certbot-nginx

# Get SSL certificate
sudo certbot --nginx -d your-domain.com

# Auto-renewal
sudo certbot renew --dry-run
```

---

## 📊 Scaling Considerations

### 1. Async Processing with Celery

```python
# celery_config.py
from celery import Celery

celery = Celery('veomagic', broker='redis://localhost:6379/0')

@celery.task
def generate_video_async(request_data):
    # Move video generation to background task
    pass
```

### 2. Database for Job Tracking

```sql
-- schema.sql
CREATE TABLE video_jobs (
    id UUID PRIMARY KEY,
    user_email VARCHAR(255),
    status VARCHAR(50),
    progress INTEGER,
    script_data JSONB,
    video_url TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

CREATE INDEX idx_video_jobs_status ON video_jobs(status);
CREATE INDEX idx_video_jobs_user ON video_jobs(user_email);
```

### 3. CDN Integration

```python
# cdn_upload.py
import boto3

def upload_to_cdn(local_path, filename):
    s3 = boto3.client('s3')
    s3.upload_file(
        local_path,
        'veomagic-videos',
        filename,
        ExtraArgs={'ACL': 'public-read'}
    )
    return f"https://cdn.veomagic.com/{filename}"
```

---

## 🧪 Testing

### Unit Tests

```python
# test_script_generator.py
import unittest
from veo_backend_service import AIScriptGenerator, VideoRequest, VideoStyle, VideoTone

class TestScriptGenerator(unittest.TestCase):
    def test_expand_idea(self):
        generator = AIScriptGenerator()
        request = VideoRequest(
            idea_title="Test Product",
            short_idea="A revolutionary product",
            company_name="TestCo",
            website="test.com",
            call_to_action="Learn More",
            style=VideoStyle.CINEMATIC,
            tone=VideoTone.PROFESSIONAL,
            target_audience="Everyone"
        )
        
        concept = generator.expand_idea(request)
        self.assertIn('hook', concept.lower())
        self.assertIn('problem', concept.lower())
```

### Load Testing

```bash
# Install locust
pip install locust

# Create locustfile.py
from locust import HttpUser, task, between

class VideoGenerationUser(HttpUser):
    wait_time = between(1, 3)
    
    @task
    def generate_video(self):
        self.client.post("/api/generate", json={
            "ideaTitle": "Test Video",
            "shortIdea": "Test idea",
            "companyName": "TestCo",
            "website": "test.com",
            "callToAction": "Learn More",
            "style": "cinematic",
            "tone": "professional",
            "targetAudience": "Everyone"
        })

# Run load test
locust -f locustfile.py --host=http://localhost:5000
```

---

## 🔍 Monitoring

### Setup Monitoring Stack

```yaml
# monitoring-compose.yml
version: '3.8'

services:
  prometheus:
    image: prom/prometheus
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
    ports:
      - "9090:9090"
  
  grafana:
    image: grafana/grafana
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
  
  node-exporter:
    image: prom/node-exporter
    ports:
      - "9100:9100"
```

### Application Metrics

```python
# metrics.py
from prometheus_client import Counter, Histogram, generate_latest

video_generation_counter = Counter('video_generations_total', 'Total video generations')
video_generation_duration = Histogram('video_generation_duration_seconds', 'Video generation duration')

@app.route('/metrics')
def metrics():
    return generate_latest()
```

---

## 🚨 Troubleshooting

### Common Issues

1. **FFmpeg not found**
   ```bash
   export PATH=$PATH:/usr/local/bin/ffmpeg
   ```

2. **Memory issues with large videos**
   ```python
   # Add to Flask config
   app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB
   ```

3. **Veo API timeout**
   ```python
   # Increase timeout in veo_generator.py
   async with self.session.post(url, timeout=300) as response:
   ```

4. **CORS errors**
   ```python
   # Update CORS config
   CORS(app, origins=['http://localhost:3000', 'https://yourdomain.com'])
   ```

---

## 📈 Performance Optimization

### 1. Video Caching

```python
import hashlib
import pickle

def get_cache_key(request_data):
    return hashlib.md5(pickle.dumps(request_data)).hexdigest()

def cache_video(key, video_path):
    redis_client.set(f"video:{key}", video_path, ex=3600)
```

### 2. Parallel Segment Generation

```python
import asyncio

async def generate_all_segments(segments, veo_generator):
    tasks = [veo_generator.generate_segment(s) for s in segments]
    results = await asyncio.gather(*tasks)
    return results
```

### 3. GPU Acceleration

```python
# For OpenCV operations
cv2.setUseOptimized(True)
cv2.setNumThreads(4)
```

---

## 📞 Support & Resources

- **Documentation**: Full API docs at `/api/docs`
- **GitHub**: [github.com/veomagic/veomagic](https://github.com)
- **Support Email**: support@veomagic.com
- **Discord Community**: [discord.gg/veomagic](https://discord.gg)

---

## 🔐 Security Best Practices

1. **API Key Management**
   - Never commit `.env` files
   - Use environment variables in production
   - Rotate keys regularly

2. **Input Validation**
   ```python
   from flask_limiter import Limiter
   
   limiter = Limiter(
       app,
       key_func=lambda: request.remote_addr,
       default_limits=["100 per hour"]
   )
   ```

3. **File Upload Security**
   ```python
   ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif'}
   
   def allowed_file(filename):
       return '.' in filename and \
              filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS
   ```

---

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

---

## 🎉 Quick Start Command

```bash
# One-line setup (after cloning)
./setup.sh && python veo_backend_service.py
```

Create `setup.sh`:

```bash
#!/bin/bash
echo "🚀 Setting up VeoMagic..."

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Create directories
mkdir -p uploads generated_videos segments temp

# Check FFmpeg
if ! command -v ffmpeg &> /dev/null; then
    echo "⚠️  FFmpeg not found. Please install FFmpeg."
    exit 1
fi

# Create .env if not exists
if [ ! -f .env ]; then
    cp .env.example .env
    echo "⚠️  Please update .env with your API keys"
fi

echo "✅ Setup complete! Run 'python veo_backend_service.py' to start."
```

---

Congratulations! Your VeoMagic system is ready to transform ideas into stunning 60-second videos! 🎬✨