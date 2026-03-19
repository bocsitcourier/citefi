#!/usr/bin/env python3
"""
VeoMagic Backend Service
Automated 60-second video generation from user ideas
"""

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import os
import json
import subprocess
import asyncio
import aiohttp
from datetime import datetime
import tempfile
from typing import Dict, List, Optional
import uuid
from PIL import Image, ImageDraw, ImageFont
import numpy as np
import cv2
from pathlib import Path
import openai
from dataclasses import dataclass
from enum import Enum

app = Flask(__name__)
CORS(app)

# Configuration
class Config:
    OPENAI_API_KEY = os.getenv('OPENAI_API_KEY', 'your-api-key')
    VEO_API_KEY = os.getenv('VEO_API_KEY', 'your-veo-key')
    VEO_API_URL = os.getenv('VEO_API_URL', 'https://api.veo.ai/v1/generate')
    OUTPUT_DIR = Path('./generated_videos')
    TEMP_DIR = Path('./temp')
    SEGMENTS_DIR = Path('./segments')
    
    # Ensure directories exist
    OUTPUT_DIR.mkdir(exist_ok=True)
    TEMP_DIR.mkdir(exist_ok=True)
    SEGMENTS_DIR.mkdir(exist_ok=True)

# Initialize OpenAI
openai.api_key = Config.OPENAI_API_KEY

class VideoStyle(Enum):
    CINEMATIC = "cinematic"
    COMEDY = "comedy"
    EMOTIONAL = "emotional"
    TECH = "tech"
    MINIMAL = "minimal"
    RETRO = "retro"
    LUXURY = "luxury"
    ACTION = "action"

class VideoTone(Enum):
    PROFESSIONAL = "professional"
    PLAYFUL = "playful"
    INSPIRATIONAL = "inspirational"
    URGENT = "urgent"
    MYSTERIOUS = "mysterious"
    FRIENDLY = "friendly"

@dataclass
class VideoRequest:
    idea_title: str
    short_idea: str
    company_name: str
    website: str
    call_to_action: str
    style: VideoStyle
    tone: VideoTone
    target_audience: str
    logo_path: Optional[str] = None

@dataclass
class VideoSegment:
    segment_number: int
    duration: str
    scene_description: str
    dialogue: str
    veo_prompt: str
    transition: str
    video_path: Optional[str] = None

class AIScriptGenerator:
    """Generate professional video scripts from brief ideas"""
    
    def __init__(self):
        self.client = openai.OpenAI(api_key=Config.OPENAI_API_KEY)
    
    def expand_idea(self, request: VideoRequest) -> Dict:
        """Expand user's brief idea into full concept"""
        
        prompt = f"""
        Expand this brief idea into a compelling 60-second video concept:
        
        Title: {request.idea_title}
        Brief Idea: {request.short_idea}
        Company: {request.company_name}
        Target Audience: {request.target_audience}
        Style: {request.style.value}
        Tone: {request.tone.value}
        
        Create a comprehensive video concept that includes:
        1. Hook - Attention-grabbing opening
        2. Problem - What challenge does the audience face?
        3. Solution - How does {request.company_name} solve it?
        4. Benefits - What improvements will users see?
        5. Proof - Evidence or testimonials
        6. Call to Action - {request.call_to_action}
        
        Make it engaging, memorable, and perfectly suited for the target audience.
        Return as JSON with these exact keys.
        """
        
        response = self.client.chat.completions.create(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0.8
        )
        
        return json.loads(response.choices[0].message.content)
    
    def generate_segments(self, request: VideoRequest, expanded_concept: Dict) -> List[VideoSegment]:
        """Generate 8 segments for 60-second video"""
        
        segments = []
        
        # Segment templates based on style
        segment_structure = self._get_segment_structure(request.style, request.tone)
        
        for i in range(1, 9):
            segment = self._create_segment(
                segment_number=i,
                request=request,
                concept=expanded_concept,
                structure=segment_structure[i-1]
            )
            segments.append(segment)
        
        return segments
    
    def _get_segment_structure(self, style: VideoStyle, tone: VideoTone) -> List[Dict]:
        """Get segment structure based on style and tone"""
        
        structures = {
            VideoStyle.CINEMATIC: [
                {"focus": "epic_opening", "duration": "0:00-0:08"},
                {"focus": "tension_build", "duration": "0:07-0:15"},
                {"focus": "conflict_peak", "duration": "0:14-0:22"},
                {"focus": "hero_moment", "duration": "0:21-0:29"},
                {"focus": "transformation", "duration": "0:28-0:36"},
                {"focus": "victory", "duration": "0:35-0:43"},
                {"focus": "inspiration", "duration": "0:42-0:50"},
                {"focus": "call_to_action", "duration": "0:49-0:60"}
            ],
            VideoStyle.COMEDY: [
                {"focus": "setup", "duration": "0:00-0:08"},
                {"focus": "problem_exaggeration", "duration": "0:07-0:15"},
                {"focus": "failed_attempts", "duration": "0:14-0:22"},
                {"focus": "unexpected_twist", "duration": "0:21-0:29"},
                {"focus": "solution_reveal", "duration": "0:28-0:36"},
                {"focus": "hilarious_results", "duration": "0:35-0:43"},
                {"focus": "callback_joke", "duration": "0:42-0:50"},
                {"focus": "punchline_cta", "duration": "0:49-0:60"}
            ],
            VideoStyle.EMOTIONAL: [
                {"focus": "personal_story", "duration": "0:00-0:08"},
                {"focus": "struggle", "duration": "0:07-0:15"},
                {"focus": "lowest_point", "duration": "0:14-0:22"},
                {"focus": "hope_appears", "duration": "0:21-0:29"},
                {"focus": "breakthrough", "duration": "0:28-0:36"},
                {"focus": "transformation", "duration": "0:35-0:43"},
                {"focus": "gratitude", "duration": "0:42-0:50"},
                {"focus": "inspire_action", "duration": "0:49-0:60"}
            ],
            VideoStyle.TECH: [
                {"focus": "future_vision", "duration": "0:00-0:08"},
                {"focus": "current_limitations", "duration": "0:07-0:15"},
                {"focus": "innovation_reveal", "duration": "0:14-0:22"},
                {"focus": "technical_demo", "duration": "0:21-0:29"},
                {"focus": "features_showcase", "duration": "0:28-0:36"},
                {"focus": "integration", "duration": "0:35-0:43"},
                {"focus": "results", "duration": "0:42-0:50"},
                {"focus": "join_future", "duration": "0:49-0:60"}
            ]
        }
        
        # Default to cinematic if style not found
        return structures.get(style, structures[VideoStyle.CINEMATIC])
    
    def _create_segment(self, segment_number: int, request: VideoRequest, 
                       concept: Dict, structure: Dict) -> VideoSegment:
        """Create individual segment with AI-generated content"""
        
        prompt = f"""
        Create segment {segment_number} of an 8-segment video.
        
        Company: {request.company_name}
        Concept: {json.dumps(concept)}
        Segment Focus: {structure['focus']}
        Style: {request.style.value}
        Tone: {request.tone.value}
        Duration: 8 seconds
        
        Generate:
        1. Scene description (visual elements)
        2. Dialogue or narration (max 15 words)
        3. Detailed Veo AI prompt for generating this 8-second clip
        4. Transition to next segment
        
        Make it compelling and aligned with the overall narrative.
        Return as JSON.
        """
        
        response = self.client.chat.completions.create(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0.7
        )
        
        segment_data = json.loads(response.choices[0].message.content)
        
        return VideoSegment(
            segment_number=segment_number,
            duration=structure['duration'],
            scene_description=segment_data.get('scene_description', ''),
            dialogue=segment_data.get('dialogue', ''),
            veo_prompt=self._optimize_veo_prompt(segment_data.get('veo_prompt', ''), request),
            transition=segment_data.get('transition', 'cut')
        )
    
    def _optimize_veo_prompt(self, base_prompt: str, request: VideoRequest) -> str:
        """Optimize prompt for Veo AI generation"""
        
        style_modifiers = {
            VideoStyle.CINEMATIC: "cinematic lighting, epic scale, dramatic camera movement, film grain",
            VideoStyle.COMEDY: "bright colors, dynamic camera, comedic timing, exaggerated expressions",
            VideoStyle.EMOTIONAL: "soft lighting, intimate framing, warm colors, handheld camera",
            VideoStyle.TECH: "clean aesthetic, futuristic elements, precise movements, blue tones",
            VideoStyle.MINIMAL: "simple composition, negative space, subtle movement, monochrome",
            VideoStyle.RETRO: "vintage filters, grain, retro colors, nostalgic elements",
            VideoStyle.LUXURY: "elegant lighting, premium materials, slow motion, gold accents",
            VideoStyle.ACTION: "fast cuts, dynamic angles, motion blur, high energy"
        }
        
        tone_modifiers = {
            VideoTone.PROFESSIONAL: "corporate quality, steady shots, clean transitions",
            VideoTone.PLAYFUL: "vibrant energy, fun movements, creative angles",
            VideoTone.INSPIRATIONAL: "uplifting imagery, heroic framing, golden hour",
            VideoTone.URGENT: "quick pacing, intense close-ups, high contrast",
            VideoTone.MYSTERIOUS: "shadows, fog, slow reveals, atmospheric",
            VideoTone.FRIENDLY: "warm approach, natural movements, inviting scenes"
        }
        
        optimized = f"{base_prompt}, {style_modifiers.get(request.style, '')}, "
        optimized += f"{tone_modifiers.get(request.tone, '')}, "
        optimized += "8 seconds exactly, 1920x1080, 30fps, high quality"
        
        return optimized

class VeoVideoGenerator:
    """Interface with Veo AI for video generation"""
    
    def __init__(self):
        self.api_key = Config.VEO_API_KEY
        self.api_url = Config.VEO_API_URL
        self.session = None
    
    async def generate_segment(self, segment: VideoSegment) -> str:
        """Generate single 8-second video segment with Veo"""
        
        if not self.session:
            self.session = aiohttp.ClientSession()
        
        headers = {
            'Authorization': f'Bearer {self.api_key}',
            'Content-Type': 'application/json'
        }
        
        payload = {
            'prompt': segment.veo_prompt,
            'duration': 8,
            'resolution': '1920x1080',
            'fps': 30,
            'style': 'high_quality'
        }
        
        try:
            async with self.session.post(
                self.api_url,
                headers=headers,
                json=payload
            ) as response:
                result = await response.json()
                
                # Poll for completion
                video_url = await self._poll_for_completion(result['job_id'])
                
                # Download video
                video_path = await self._download_video(
                    video_url,
                    f"segment_{segment.segment_number}.mp4"
                )
                
                return video_path
        
        except Exception as e:
            print(f"Error generating segment {segment.segment_number}: {e}")
            # Return placeholder video if Veo fails
            return self._create_placeholder_video(segment)
    
    async def _poll_for_completion(self, job_id: str, max_attempts: int = 60) -> str:
        """Poll Veo API for job completion"""
        
        status_url = f"{self.api_url}/status/{job_id}"
        
        for _ in range(max_attempts):
            async with self.session.get(status_url) as response:
                result = await response.json()
                
                if result['status'] == 'completed':
                    return result['video_url']
                elif result['status'] == 'failed':
                    raise Exception(f"Veo generation failed: {result.get('error')}")
            
            await asyncio.sleep(5)  # Wait 5 seconds between polls
        
        raise Exception("Veo generation timeout")
    
    async def _download_video(self, url: str, filename: str) -> str:
        """Download generated video from Veo"""
        
        output_path = Config.SEGMENTS_DIR / filename
        
        async with self.session.get(url) as response:
            with open(output_path, 'wb') as f:
                async for chunk in response.content.iter_chunked(8192):
                    f.write(chunk)
        
        return str(output_path)
    
    def _create_placeholder_video(self, segment: VideoSegment) -> str:
        """Create placeholder video if Veo fails"""
        
        output_path = Config.SEGMENTS_DIR / f"segment_{segment.segment_number}.mp4"
        
        # Create 8-second placeholder with OpenCV
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        out = cv2.VideoWriter(str(output_path), fourcc, 30.0, (1920, 1080))
        
        # Create frame with segment info
        for frame_num in range(30 * 8):  # 8 seconds at 30fps
            img = np.zeros((1080, 1920, 3), dtype=np.uint8)
            
            # Add gradient background
            for y in range(1080):
                color_val = int(255 * (1 - y / 1080))
                img[y, :] = [color_val // 3, color_val // 2, color_val]
            
            # Add text
            cv2.putText(img, f"Segment {segment.segment_number}",
                       (100, 500), cv2.FONT_HERSHEY_SIMPLEX, 3, (255, 255, 255), 3)
            cv2.putText(img, segment.scene_description[:50],
                       (100, 600), cv2.FONT_HERSHEY_SIMPLEX, 1, (200, 200, 200), 2)
            
            out.write(img)
        
        out.release()
        return str(output_path)

class VideoStitcher:
    """Stitch video segments into final 60-second video"""
    
    def __init__(self):
        self.ffmpeg_path = 'ffmpeg'  # Assume ffmpeg is in PATH
    
    def stitch_segments(self, segments: List[VideoSegment], 
                       output_filename: str,
                       logo_path: Optional[str] = None,
                       company_name: str = "",
                       website: str = "",
                       call_to_action: str = "") -> str:
        """Stitch all segments with transitions and branding"""
        
        output_path = Config.OUTPUT_DIR / output_filename
        
        # Create filter complex for transitions
        filter_complex = self._build_filter_complex(segments, logo_path)
        
        # Build FFmpeg command
        cmd = [self.ffmpeg_path]
        
        # Add all segment videos as inputs
        for segment in segments:
            cmd.extend(['-i', segment.video_path])
        
        # Add logo if provided
        if logo_path:
            cmd.extend(['-i', logo_path])
        
        # Add filter complex
        cmd.extend([
            '-filter_complex', filter_complex,
            '-map', '[final]',
            '-c:v', 'libx264',
            '-preset', 'medium',
            '-crf', '23',
            '-c:a', 'aac',
            '-b:a', '192k',
            str(output_path)
        ])
        
        # Execute FFmpeg
        try:
            subprocess.run(cmd, check=True, capture_output=True, text=True)
            
            # Add end card with CTA
            if call_to_action:
                self._add_end_card(output_path, company_name, website, call_to_action)
            
            return str(output_path)
        
        except subprocess.CalledProcessError as e:
            print(f"FFmpeg error: {e.stderr}")
            raise Exception(f"Video stitching failed: {e}")
    
    def _build_filter_complex(self, segments: List[VideoSegment], 
                             logo_path: Optional[str]) -> str:
        """Build FFmpeg filter for smooth transitions"""
        
        filters = []
        
        # Process each segment with transitions
        for i, segment in enumerate(segments):
            if i == 0:
                # First segment
                filters.append(f"[0:v]settb=AVTB,setpts=PTS-STARTPTS,scale=1920:1080[v0];")
            else:
                # Add crossfade transition
                prev = f"v{i-1}" if i == 1 else f"cf{i-1}"
                filters.append(
                    f"[{i}:v]settb=AVTB,setpts=PTS-STARTPTS+{(i*7)}/TB,"
                    f"scale=1920:1080[v{i}];"
                )
                
                if i < len(segments) - 1:
                    filters.append(
                        f"[{prev}][v{i}]xfade=transition=fade:duration=1:offset={(i*7)}[cf{i}];"
                    )
                else:
                    # Last segment
                    output = "[prefinal]"
                    filters.append(
                        f"[{prev}][v{i}]xfade=transition=fade:duration=1:offset={(i*7)}{output};"
                    )
        
        # Add logo overlay if provided
        if logo_path:
            logo_index = len(segments)
            filters.append(
                f"[{logo_index}:v]scale=150:-1[logo];"
                f"[prefinal][logo]overlay=W-w-50:50[final]"
            )
        else:
            filters.append("[prefinal]copy[final]")
        
        return ''.join(filters)
    
    def _add_end_card(self, video_path: Path, company_name: str, 
                     website: str, call_to_action: str):
        """Add branded end card to video"""
        
        # Create end card image
        end_card = Image.new('RGB', (1920, 1080), color=(10, 14, 39))
        draw = ImageDraw.Draw(end_card)
        
        # Add text (would need proper font files in production)
        try:
            font_large = ImageFont.truetype("arial.ttf", 80)
            font_medium = ImageFont.truetype("arial.ttf", 50)
            font_small = ImageFont.truetype("arial.ttf", 40)
        except:
            font_large = ImageFont.load_default()
            font_medium = ImageFont.load_default()
            font_small = ImageFont.load_default()
        
        # Draw company name
        draw.text((960, 400), company_name, font=font_large, 
                 anchor="mm", fill=(255, 190, 11))
        
        # Draw CTA
        draw.text((960, 540), call_to_action, font=font_medium,
                 anchor="mm", fill=(255, 255, 255))
        
        # Draw website
        draw.text((960, 650), website, font=font_small,
                 anchor="mm", fill=(200, 200, 200))
        
        # Save end card
        end_card_path = Config.TEMP_DIR / "end_card.png"
        end_card.save(end_card_path)
        
        # Overlay end card on last 2 seconds
        temp_output = Config.TEMP_DIR / "temp_final.mp4"
        
        cmd = [
            self.ffmpeg_path,
            '-i', str(video_path),
            '-i', str(end_card_path),
            '-filter_complex',
            '[1:v]fade=in:st=0:d=0.5:alpha=1[card];'
            '[0:v][card]overlay=0:0:enable=\'between(t,58,60)\'[v]',
            '-map', '[v]',
            '-map', '0:a?',
            '-c:v', 'libx264',
            '-c:a', 'copy',
            str(temp_output)
        ]
        
        subprocess.run(cmd, check=True, capture_output=True)
        
        # Replace original with version containing end card
        temp_output.replace(video_path)

# Flask Routes

@app.route('/api/generate', methods=['POST'])
async def generate_video():
    """Main endpoint for video generation"""
    
    try:
        # Parse request
        data = request.json
        
        # Handle logo upload if present
        logo_path = None
        if 'logo' in request.files:
            logo = request.files['logo']
            logo_path = Config.TEMP_DIR / f"{uuid.uuid4()}_{logo.filename}"
            logo.save(logo_path)
        
        # Create video request
        video_request = VideoRequest(
            idea_title=data['ideaTitle'],
            short_idea=data['shortIdea'],
            company_name=data['companyName'],
            website=data['website'],
            call_to_action=data['callToAction'],
            style=VideoStyle(data['style']),
            tone=VideoTone(data['tone']),
            target_audience=data['targetAudience'],
            logo_path=str(logo_path) if logo_path else None
        )
        
        # Initialize services
        script_generator = AIScriptGenerator()
        veo_generator = VeoVideoGenerator()
        stitcher = VideoStitcher()
        
        # Generate script
        expanded_concept = script_generator.expand_idea(video_request)
        segments = script_generator.generate_segments(video_request, expanded_concept)
        
        # Generate video segments with Veo
        for segment in segments:
            segment.video_path = await veo_generator.generate_segment(segment)
        
        # Stitch final video
        output_filename = f"{uuid.uuid4()}_final.mp4"
        final_video_path = stitcher.stitch_segments(
            segments,
            output_filename,
            video_request.logo_path,
            video_request.company_name,
            video_request.website,
            video_request.call_to_action
        )
        
        # Prepare response
        response_data = {
            'success': True,
            'video_url': f'/api/download/{output_filename}',
            'segments': [
                {
                    'segment_number': s.segment_number,
                    'duration': s.duration,
                    'scene_description': s.scene_description,
                    'dialogue': s.dialogue,
                    'veo_prompt': s.veo_prompt,
                    'transition': s.transition
                }
                for s in segments
            ],
            'script_url': f'/api/script/{output_filename.replace(".mp4", ".json")}',
            'duration': '60 seconds',
            'resolution': '1920x1080',
            'fps': 30
        }
        
        # Save script
        script_path = Config.OUTPUT_DIR / output_filename.replace('.mp4', '.json')
        with open(script_path, 'w') as f:
            json.dump(response_data, f, indent=2)
        
        return jsonify(response_data)
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/download/<filename>', methods=['GET'])
def download_video(filename):
    """Download generated video"""
    
    file_path = Config.OUTPUT_DIR / filename
    if file_path.exists():
        return send_file(file_path, as_attachment=True)
    else:
        return jsonify({'error': 'File not found'}), 404

@app.route('/api/script/<filename>', methods=['GET'])
def download_script(filename):
    """Download generated script"""
    
    file_path = Config.OUTPUT_DIR / filename
    if file_path.exists():
        return send_file(file_path, as_attachment=True)
    else:
        return jsonify({'error': 'Script not found'}), 404

@app.route('/api/status/<job_id>', methods=['GET'])
def check_status(job_id):
    """Check generation status"""
    
    # Implementation would track async job status
    return jsonify({
        'job_id': job_id,
        'status': 'processing',
        'progress': 50,
        'message': 'Generating video segments...'
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)