#!/bin/bash
#
# VeoMagic Fast - Quick Setup Script
# No database required, minimal dependencies
#

echo "========================================="
echo "   VeoMagic Fast - Video Generator"
echo "   Setup & Installation"
echo "========================================="
echo ""

# Check Python version
echo "✓ Checking Python version..."
python_version=$(python3 --version 2>&1 | grep -Po '(?<=Python )\d+\.\d+')
if [ -z "$python_version" ]; then
    echo "❌ Python 3 is not installed. Please install Python 3.8 or higher."
    exit 1
fi
echo "  Python $python_version detected"

# Check FFmpeg
echo "✓ Checking FFmpeg..."
if ! command -v ffmpeg &> /dev/null; then
    echo "❌ FFmpeg is not installed."
    echo ""
    echo "Please install FFmpeg:"
    echo "  Ubuntu/Debian: sudo apt-get install ffmpeg"
    echo "  macOS: brew install ffmpeg"
    echo "  Windows: Download from https://ffmpeg.org/download.html"
    exit 1
else
    ffmpeg_version=$(ffmpeg -version | head -n1)
    echo "  $ffmpeg_version"
fi

# Create virtual environment
echo ""
echo "✓ Creating virtual environment..."
if [ -d "venv" ]; then
    echo "  Virtual environment already exists"
else
    python3 -m venv venv
    echo "  Virtual environment created"
fi

# Activate virtual environment
echo "✓ Activating virtual environment..."
source venv/bin/activate

# Install requirements
echo "✓ Installing Python packages..."
cat > requirements_minimal.txt << EOF
flask==2.3.0
flask-cors==4.0.0
EOF

pip install -q -r requirements_minimal.txt
echo "  Flask and CORS installed"

# Create necessary directories
echo "✓ Creating directories..."
mkdir -p generated_videos temp cache templates
echo "  Directories created"

# Create run script
echo "✓ Creating run script..."
cat > run.sh << 'EOF'
#!/bin/bash
source venv/bin/activate
echo "Starting VeoMagic Fast Server..."
echo "Server will be available at http://localhost:5000"
echo "Frontend will be available at http://localhost:8000"
echo ""
echo "Press Ctrl+C to stop"
echo ""

# Start backend server
python3 veomagic_fast.py &
BACKEND_PID=$!

# Start frontend server
echo "Starting frontend server..."
python3 -m http.server 8000 --directory . &
FRONTEND_PID=$!

echo ""
echo "========================================="
echo "  VeoMagic Fast is running!"
echo "  Backend: http://localhost:5000"
echo "  Frontend: http://localhost:8000/veomagic_fast_frontend.html"
echo "========================================="
echo ""

# Wait for Ctrl+C
trap "echo 'Shutting down...'; kill $BACKEND_PID $FRONTEND_PID; exit" INT
wait
EOF

chmod +x run.sh

# Create test script
echo "✓ Creating test script..."
cat > test_generation.py << 'EOF'
#!/usr/bin/env python3
import requests
import time
import json

def test_video_generation():
    """Test the video generation pipeline"""
    
    print("Testing VeoMagic Fast video generation...")
    
    # Test data
    data = {
        "ideaTitle": "Test Product",
        "shortIdea": "A revolutionary product that solves problems.",
        "companyName": "TestCorp",
        "website": "www.test.com",
        "callToAction": "Get Started!",
        "style": "professional",
        "targetAudience": "Everyone"
    }
    
    # Start generation
    print("\n1. Starting generation...")
    response = requests.post('http://localhost:5000/api/generate', json=data)
    result = response.json()
    
    if not result['success']:
        print(f"❌ Generation failed: {result.get('error')}")
        return
    
    job_id = result['job_id']
    print(f"✓ Job created: {job_id}")
    
    # Poll for status
    print("\n2. Polling for status...")
    start_time = time.time()
    
    while True:
        response = requests.get(f'http://localhost:5000/api/status/{job_id}')
        status = response.json()
        
        print(f"  Progress: {status['progress']}% - {status['status']}")
        
        if status['status'] == 'completed':
            elapsed = time.time() - start_time
            print(f"\n✓ Video generated successfully in {elapsed:.1f} seconds!")
            print(f"  Video URL: {status['result']['video_url']}")
            break
        elif status['status'] == 'failed':
            print(f"\n❌ Generation failed: {status.get('error')}")
            break
        
        time.sleep(1)

if __name__ == '__main__':
    test_video_generation()
EOF

chmod +x test_generation.py

# Success message
echo ""
echo "========================================="
echo "✅ Setup Complete!"
echo "========================================="
echo ""
echo "To start VeoMagic Fast:"
echo "  ./run.sh"
echo ""
echo "Then open in your browser:"
echo "  http://localhost:8000/veomagic_fast_frontend.html"
echo ""
echo "To test the API:"
echo "  python3 test_generation.py"
echo ""
echo "Features:"
echo "  ⚡ No database required"
echo "  ⚡ Generates videos in 10-30 seconds"
echo "  ⚡ Parallel processing"
echo "  ⚡ Smart caching"
echo "  ⚡ Mock mode for testing"
echo ""
echo "Troubleshooting:"
echo "  - Make sure ports 5000 and 8000 are free"
echo "  - Check that FFmpeg is installed"
echo "  - Run 'source venv/bin/activate' if needed"
echo "========================================="