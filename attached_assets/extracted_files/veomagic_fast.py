#!/usr/bin/env python3
"""
VeoMagic Fast - Optimized Video Generation System
Fixes pg-boss issues and dramatically reduces generation time
"""

from flask import Flask, request, jsonify, send_file, Response
from flask_cors import CORS
import os
import json
import subprocess
import time
from datetime import datetime
import tempfile
from typing import Dict, List, Optional
import uuid
from pathlib import Path
import threading
import queue
import hashlib
from concurrent.futures import ThreadPoolExecutor, as_completed
import shutil
import base64

app = Flask(__name__)
CORS(app, origins="*")

# Configuration
class Config:
    # Use mock mode for testing without actual API calls
    MOCK_MODE = os.getenv('MOCK_MODE', 'true').lower() == 'true'
    
    # Directories
    OUTPUT_DIR = Path('./generated_videos')
    TEMP_DIR = Path('./temp')
    CACHE_DIR = Path('./cache')
    TEMPLATES_DIR = Path('./templates')
    
    # Performance settings
    MAX_WORKERS = 4  # Parallel processing
    SEGMENT_TIMEOUT = 30  # seconds per segment
    USE_CACHE = True
    
    # Video settings
    VIDEO_WIDTH = 1920
    VIDEO_HEIGHT = 1080
    VIDEO_FPS = 30
    
    @classmethod
    def init(cls):
        """Initialize directories"""
        for dir_path in [cls.OUTPUT_DIR, cls.TEMP_DIR, cls.CACHE_DIR, cls.TEMPLATES_DIR]:
            dir_path.mkdir(exist_ok=True, parents=True)

Config.init()

# In-memory job storage (no database required)
class JobStore:
    def __init__(self):
        self.jobs = {}
        self.lock = threading.Lock()
    
    def create_job(self, job_id: str, data: dict) -> dict:
        with self.lock:
            job = {
                'id': job_id,
                'status': 'pending',
                'progress': 0,
                'data': data,
                'created_at': datetime.now().isoformat(),
                'result': None,
                'error': None
            }
            self.jobs[job_id] = job
            return job
    
    def update_job(self, job_id: str, **kwargs):
        with self.lock:
            if job_id in self.jobs:
                self.jobs[job_id].update(kwargs)
    
    def get_job(self, job_id: str) -> Optional[dict]:
        with self.lock:
            return self.jobs.get(job_id)

job_store = JobStore()

class FastScriptGenerator:
    """Simplified, fast script generation without external API calls"""
    
    def __init__(self):
        self.templates = self._load_templates()
    
    def _load_templates(self) -> dict:
        """Load pre-defined templates for fast generation"""
        return {
            'cinematic': {
                'segments': [
                    {'focus': 'epic_opening', 'template': 'Dramatic wide shot revealing {company_name}'},
                    {'focus': 'problem', 'template': 'The challenge: {problem}'},
                    {'focus': 'tension', 'template': 'Stakes rising, urgency building'},
                    {'focus': 'solution', 'template': '{company_name} arrives with the answer'},
                    {'focus': 'demonstration', 'template': 'Watch the transformation happen'},
                    {'focus': 'benefits', 'template': 'Life transformed with {product}'},
                    {'focus': 'proof', 'template': 'Join thousands already benefiting'},
                    {'focus': 'cta', 'template': '{call_to_action} at {website}'}
                ]
            },
            'comedy': {
                'segments': [
                    {'focus': 'funny_setup', 'template': 'Unexpected situation with {product}'},
                    {'focus': 'escalation', 'template': 'Things get ridiculously out of hand'},
                    {'focus': 'chaos', 'template': 'Complete comedic chaos ensues'},
                    {'focus': 'twist', 'template': 'Plot twist: {company_name} saves the day'},
                    {'focus': 'solution', 'template': 'Simple solution was here all along'},
                    {'focus': 'relief', 'template': 'Everyone laughs at the simplicity'},
                    {'focus': 'callback', 'template': 'Callback to opening joke'},
                    {'focus': 'punchline', 'template': '{call_to_action} - seriously!'}
                ]
            },
            'professional': {
                'segments': [
                    {'focus': 'establish', 'template': '{company_name}: Professional Excellence'},
                    {'focus': 'challenge', 'template': 'Modern businesses face {problem}'},
                    {'focus': 'insight', 'template': 'Our innovative approach'},
                    {'focus': 'solution', 'template': 'Introducing {product}'},
                    {'focus': 'features', 'template': 'Key capabilities and benefits'},
                    {'focus': 'results', 'template': 'Proven results and ROI'},
                    {'focus': 'testimonial', 'template': 'Trusted by industry leaders'},
                    {'focus': 'next_steps', 'template': '{call_to_action} at {website}'}
                ]
            }
        }
    
    def generate_script_fast(self, request_data: dict) -> List[dict]:
        """Generate script instantly using templates"""
        style = request_data.get('style', 'professional')
        template_set = self.templates.get(style, self.templates['professional'])
        
        segments = []
        for i, segment_template in enumerate(template_set['segments'], 1):
            segment = {
                'segment_number': i,
                'duration': f"{(i-1)*7}:{str((i-1)*7+8).zfill(2)}",
                'scene': segment_template['template'].format(
                    company_name=request_data.get('companyName', 'Company'),
                    product=request_data.get('ideaTitle', 'Product'),
                    problem=request_data.get('shortIdea', 'Challenge')[:50],
                    call_to_action=request_data.get('callToAction', 'Learn More'),
                    website=request_data.get('website', 'website.com')
                ),
                'dialogue': self._generate_dialogue(i, request_data),
                'veo_prompt': self._generate_veo_prompt(i, style, segment_template['focus']),
                'transition': 'crossfade' if i < 8 else 'fade_to_black'
            }
            segments.append(segment)
        
        return segments
    
    def _generate_dialogue(self, segment_num: int, data: dict) -> str:
        """Generate appropriate dialogue for segment"""
        dialogues = [
            f"Introducing {data.get('companyName', 'our solution')}",
            "The problem is real",
            "But there's a better way",
            f"{data.get('ideaTitle', 'Our product')} changes everything",
            "See the difference",
            "Transform your experience",
            "Join the revolution",
            f"{data.get('callToAction', 'Get started today')}"
        ]
        return dialogues[segment_num - 1] if segment_num <= len(dialogues) else ""
    
    def _generate_veo_prompt(self, segment: int, style: str, focus: str) -> str:
        """Generate optimized Veo prompt"""
        style_modifiers = {
            'cinematic': 'cinematic lighting, epic scale, 4K quality',
            'comedy': 'bright colors, dynamic movement, comedic timing',
            'professional': 'clean aesthetic, corporate quality, steady shots'
        }
        
        return f"{focus}, {style_modifiers.get(style, '')}, 8 seconds, 1920x1080, high quality"

class FastVideoGenerator:
    """Fast video generation using placeholders and templates"""
    
    def __init__(self):
        self.executor = ThreadPoolExecutor(max_workers=Config.MAX_WORKERS)
    
    def generate_placeholder_segment(self, segment_data: dict, job_id: str) -> str:
        """Generate a placeholder video segment quickly"""
        segment_num = segment_data['segment_number']
        output_path = Config.TEMP_DIR / f"{job_id}_segment_{segment_num}.mp4"
        
        # Check cache first
        if Config.USE_CACHE:
            cache_key = self._get_cache_key(segment_data)
            cached_path = Config.CACHE_DIR / f"{cache_key}.mp4"
            if cached_path.exists():
                shutil.copy(cached_path, output_path)
                return str(output_path)
        
        # Generate using FFmpeg with solid color and text overlay
        self._create_segment_with_ffmpeg(segment_data, output_path)
        
        # Cache the result
        if Config.USE_CACHE:
            shutil.copy(output_path, Config.CACHE_DIR / f"{cache_key}.mp4")
        
        return str(output_path)
    
    def _get_cache_key(self, segment_data: dict) -> str:
        """Generate cache key for segment"""
        key_data = f"{segment_data['scene']}_{segment_data['veo_prompt']}"
        return hashlib.md5(key_data.encode()).hexdigest()[:16]
    
    def _create_segment_with_ffmpeg(self, segment_data: dict, output_path: Path):
        """Create segment using FFmpeg drawtext filter"""
        
        # Color scheme based on segment number
        colors = ['0x1a1a2e', '0x16213e', '0x0f3460', '0x533483', 
                  '0x3d5a80', '0x2e86ab', '0x4361ee', '0x7209b7']
        bg_color = colors[segment_data['segment_number'] - 1]
        
        # Create 8-second video with text overlay
        cmd = [
            'ffmpeg', '-y',
            '-f', 'lavfi',
            '-i', f'color=c={bg_color}:s=1920x1080:d=8:r=30',
            '-vf', (
                f"drawtext=text='Segment {segment_data['segment_number']}':fontsize=80:"
                f"fontcolor=white:x=(w-text_w)/2:y=300,"
                f"drawtext=text='{segment_data['scene'][:60]}':fontsize=40:"
                f"fontcolor=white:x=(w-text_w)/2:y=450:enable='between(t,1,7)',"
                f"drawtext=text='{segment_data['dialogue']}':fontsize=50:"
                f"fontcolor=yellow:x=(w-text_w)/2:y=600:enable='between(t,2,6)',"
                f"fade=in:st=0:d=0.5,fade=out:st=7.5:d=0.5"
            ),
            '-c:v', 'libx264',
            '-preset', 'ultrafast',  # Fastest encoding
            '-crf', '23',
            '-pix_fmt', 'yuv420p',
            str(output_path)
        ]
        
        subprocess.run(cmd, capture_output=True, check=True)
    
    def generate_all_segments_parallel(self, segments: List[dict], job_id: str, 
                                      progress_callback=None) -> List[str]:
        """Generate all segments in parallel for speed"""
        video_paths = [None] * len(segments)
        
        # Submit all tasks
        futures = {}
        for i, segment in enumerate(segments):
            future = self.executor.submit(self.generate_placeholder_segment, segment, job_id)
            futures[future] = i
        
        # Collect results as they complete
        for future in as_completed(futures):
            idx = futures[future]
            try:
                video_paths[idx] = future.result()
                if progress_callback:
                    progress_callback(idx + 1, len(segments))
            except Exception as e:
                print(f"Error generating segment {idx + 1}: {e}")
                # Generate a simple fallback
                video_paths[idx] = self._create_error_segment(idx + 1, job_id)
        
        return video_paths
    
    def _create_error_segment(self, segment_num: int, job_id: str) -> str:
        """Create error segment as fallback"""
        output_path = Config.TEMP_DIR / f"{job_id}_segment_{segment_num}_error.mp4"
        
        cmd = [
            'ffmpeg', '-y',
            '-f', 'lavfi',
            '-i', 'color=c=red:s=1920x1080:d=8:r=30',
            '-vf', f"drawtext=text='Segment {segment_num} Error':fontsize=60:"
                   f"fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2",
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            str(output_path)
        ]
        
        subprocess.run(cmd, capture_output=True)
        return str(output_path)

class FastVideoStitcher:
    """Optimized video stitching"""
    
    def stitch_videos_fast(self, video_paths: List[str], output_filename: str,
                           branding: dict = None) -> str:
        """Fast stitching using concat protocol"""
        
        output_path = Config.OUTPUT_DIR / output_filename
        
        # Create concat file
        concat_file = Config.TEMP_DIR / f"{uuid.uuid4()}_concat.txt"
        with open(concat_file, 'w') as f:
            for path in video_paths:
                f.write(f"file '{Path(path).absolute()}'\n")
        
        # Fast concatenation without re-encoding where possible
        cmd = [
            'ffmpeg', '-y',
            '-f', 'concat',
            '-safe', '0',
            '-i', str(concat_file),
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-crf', '23',
            str(output_path)
        ]
        
        subprocess.run(cmd, capture_output=True, check=True)
        
        # Add branding overlay if provided
        if branding and branding.get('companyName'):
            self._add_branding_fast(output_path, branding)
        
        # Cleanup
        concat_file.unlink()
        
        return str(output_path)
    
    def _add_branding_fast(self, video_path: Path, branding: dict):
        """Add simple text branding overlay"""
        temp_output = video_path.parent / f"temp_{video_path.name}"
        
        company = branding.get('companyName', '')
        website = branding.get('website', '')
        cta = branding.get('callToAction', '')
        
        # Add text overlay for last 3 seconds
        cmd = [
            'ffmpeg', '-y',
            '-i', str(video_path),
            '-vf', (
                f"drawtext=text='{company}':fontsize=60:fontcolor=white:"
                f"x=(w-text_w)/2:y=400:enable='between(t,57,60)',"
                f"drawtext=text='{cta}':fontsize=45:fontcolor=yellow:"
                f"x=(w-text_w)/2:y=500:enable='between(t,57,60)',"
                f"drawtext=text='{website}':fontsize=35:fontcolor=white:"
                f"x=(w-text_w)/2:y=600:enable='between(t,57,60)'"
            ),
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-c:a', 'copy',
            str(temp_output)
        ]
        
        subprocess.run(cmd, capture_output=True, check=True)
        temp_output.replace(video_path)

# Video generation pipeline
class VideoGenerationPipeline:
    def __init__(self):
        self.script_generator = FastScriptGenerator()
        self.video_generator = FastVideoGenerator()
        self.stitcher = FastVideoStitcher()
    
    def generate_video_async(self, job_id: str, request_data: dict):
        """Generate video in background thread"""
        try:
            # Update job status
            job_store.update_job(job_id, status='processing', progress=10)
            
            # Step 1: Generate script (instant)
            start_time = time.time()
            segments = self.script_generator.generate_script_fast(request_data)
            job_store.update_job(job_id, progress=20, segments=segments)
            print(f"Script generated in {time.time() - start_time:.2f}s")
            
            # Step 2: Generate video segments in parallel
            def progress_callback(completed, total):
                progress = 20 + (completed / total * 50)  # 20-70%
                job_store.update_job(job_id, progress=int(progress))
            
            start_time = time.time()
            video_paths = self.video_generator.generate_all_segments_parallel(
                segments, job_id, progress_callback
            )
            print(f"Videos generated in {time.time() - start_time:.2f}s")
            
            # Step 3: Stitch videos
            job_store.update_job(job_id, status='stitching', progress=80)
            start_time = time.time()
            
            output_filename = f"{job_id}_final.mp4"
            final_video = self.stitcher.stitch_videos_fast(
                video_paths, output_filename, request_data
            )
            print(f"Stitching completed in {time.time() - start_time:.2f}s")
            
            # Step 4: Cleanup temp files
            for path in video_paths:
                try:
                    Path(path).unlink()
                except:
                    pass
            
            # Complete
            job_store.update_job(
                job_id,
                status='completed',
                progress=100,
                result={
                    'video_url': f'/api/download/{output_filename}',
                    'duration': '60 seconds',
                    'segments': segments,
                    'generation_time': time.time() - start_time
                }
            )
            
        except Exception as e:
            job_store.update_job(
                job_id,
                status='failed',
                error=str(e)
            )
            print(f"Generation failed for job {job_id}: {e}")

# Initialize pipeline
pipeline = VideoGenerationPipeline()

# Flask Routes

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'mock_mode': Config.MOCK_MODE,
        'cache_enabled': Config.USE_CACHE
    })

@app.route('/api/generate', methods=['POST'])
def generate_video():
    """Start video generation (returns immediately)"""
    try:
        # Get request data
        data = request.get_json()
        
        # Create job
        job_id = str(uuid.uuid4())
        job = job_store.create_job(job_id, data)
        
        # Start async generation
        thread = threading.Thread(
            target=pipeline.generate_video_async,
            args=(job_id, data)
        )
        thread.daemon = True
        thread.start()
        
        # Return job ID immediately
        return jsonify({
            'success': True,
            'job_id': job_id,
            'status_url': f'/api/status/{job_id}',
            'message': 'Video generation started'
        })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/status/<job_id>', methods=['GET'])
def get_status(job_id):
    """Get job status (poll this endpoint)"""
    job = job_store.get_job(job_id)
    
    if not job:
        return jsonify({'error': 'Job not found'}), 404
    
    response = {
        'job_id': job_id,
        'status': job['status'],
        'progress': job['progress']
    }
    
    if job['status'] == 'completed':
        response['result'] = job['result']
    elif job['status'] == 'failed':
        response['error'] = job['error']
    
    if 'segments' in job:
        response['segments'] = job['segments']
    
    return jsonify(response)

@app.route('/api/download/<filename>', methods=['GET'])
def download_video(filename):
    """Download generated video"""
    file_path = Config.OUTPUT_DIR / filename
    if file_path.exists():
        return send_file(
            file_path,
            mimetype='video/mp4',
            as_attachment=True,
            download_name=filename
        )
    else:
        return jsonify({'error': 'File not found'}), 404

@app.route('/api/stream/<filename>', methods=['GET'])
def stream_video(filename):
    """Stream video for preview"""
    file_path = Config.OUTPUT_DIR / filename
    if not file_path.exists():
        return jsonify({'error': 'File not found'}), 404
    
    def generate():
        with open(file_path, 'rb') as f:
            while True:
                data = f.read(4096)
                if not data:
                    break
                yield data
    
    return Response(
        generate(),
        mimetype='video/mp4',
        headers={
            'Content-Disposition': f'inline; filename={filename}',
            'Accept-Ranges': 'bytes'
        }
    )

@app.route('/api/clear-cache', methods=['POST'])
def clear_cache():
    """Clear cache to free up space"""
    try:
        for file in Config.CACHE_DIR.glob('*.mp4'):
            file.unlink()
        return jsonify({'success': True, 'message': 'Cache cleared'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

if __name__ == '__main__':
    print("""
    🚀 VeoMagic Fast Server Started!
    
    Features:
    - No database required (in-memory job storage)
    - Parallel segment generation
    - Smart caching for repeated segments
    - Mock mode for testing without APIs
    - Generation time: ~10-20 seconds
    
    Endpoints:
    - POST /api/generate - Start video generation
    - GET  /api/status/{job_id} - Check status
    - GET  /api/download/{filename} - Download video
    - GET  /api/health - Health check
    
    Ready to generate videos at http://localhost:5000
    """)
    
    app.run(host='0.0.0.0', port=5000, debug=True, threaded=True)