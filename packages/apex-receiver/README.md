# @apex/receiver

Content receiver package for ApexContent Engine. Receives articles, images, videos, and podcasts with full SEO preservation and stores them locally on your website.

## Features

- **Full SEO Preservation**: Creates pages with proper slugs, meta titles, descriptions, keywords, JSON-LD schema, and Open Graph tags
- **Dofollow Links**: All hyperlinks are preserved as dofollow
- **Local Media Storage**: Downloads and stores all images, videos, and audio files locally
- **HMAC Authentication**: Secure communication with ApexContent Engine
- **Callback System**: Reports delivery status back to ApexContent Engine

## Quick Start

### 1. Installation

```bash
npm install @apex/receiver
# or
yarn add @apex/receiver
```

### 2. Configuration

Create a `.env` file:

```env
APEX_API_KEY=your-api-key-from-apex-engine
APEX_ENGINE_URL=https://your-apex-engine.replit.app
BASE_URL=https://yoursite.com
PORT=3000
STORAGE_PATH=./uploads
```

**Getting Your API Key:**

1. Log in to ApexContent Engine
2. Go to Settings → Publishing Connections
3. Click "Add Connection" and select "Website"
4. Enter your website URL and a name
5. Copy the API key shown (it's only displayed once!)
6. Paste the API key as APEX_API_KEY in your receiver's .env file

The API key is used for HMAC signature verification. Both ApexContent Engine and the receiver must have the same key to authenticate requests.

### 3. Run the Server

```bash
npm start
```

## Deployment on DigitalOcean

### Option 1: App Platform

1. Push this package to a GitHub repository
2. Create a new App in DigitalOcean App Platform
3. Connect your repository
4. Add environment variables in the App settings
5. Deploy

### Option 2: Droplet with Docker

```bash
# Clone your repo
git clone https://github.com/your-org/apex-receiver.git
cd apex-receiver

# Create .env file
cp .env.example .env
nano .env  # Edit with your values

# Build and run
docker build -t apex-receiver .
docker run -d \
  --name apex-receiver \
  -p 3000:3000 \
  --env-file .env \
  -v $(pwd)/uploads:/app/uploads \
  -v $(pwd)/pages:/app/pages \
  apex-receiver
```

### Option 3: PM2 (without Docker)

```bash
npm install
npm run build
pm2 start dist/bin/start.js --name apex-receiver
```

## API Endpoints

### Health Check
```
GET /api/v1/status/ping
```
No authentication required. Used by ApexContent Engine to verify receiver is online.

### Receive Article
```
POST /api/v1/articles
Headers:
  X-Apex-Signature: <hmac-signature>
  X-Apex-Timestamp: <unix-timestamp-ms>
```
Creates an SEO-optimized HTML page with:
- Meta title, description, keywords
- JSON-LD structured data
- Open Graph tags
- Downloaded and locally-stored images
- Proper canonical URL

### Receive Media
```
POST /api/v1/media
POST /api/v1/media/batch
```
Downloads and stores media files (images, videos, audio) locally.

### Receive Podcast
```
POST /api/v1/podcasts
```
Downloads audio file and creates a podcast page with PodcastEpisode schema.

## Directory Structure

After running, your server will have:

```
your-site/
├── uploads/
│   ├── images/      # Downloaded article images
│   ├── videos/      # Downloaded videos
│   └── audio/       # Downloaded podcasts/audio
├── pages/
│   ├── article-slug.html
│   └── podcasts/
│       └── podcast-slug.html
```

## Integration with Your Existing Site

### Option 1: Serve pages directly

Configure your web server (nginx, Apache) to serve the `pages/` directory:

```nginx
location / {
    root /path/to/pages;
    try_files $uri $uri.html $uri/ =404;
}
```

### Option 2: Custom integration

Use the receiver as a library and customize page generation:

```typescript
import { createApp } from '@apex/receiver';

const app = createApp({
  enableCors: true,
});

// Add your custom routes
app.get('/custom', (req, res) => {
  res.send('Custom route');
});

app.listen(3000);
```

## Security

- All incoming requests are verified using HMAC-SHA256 signatures
- Timestamps are validated to prevent replay attacks (5-minute window)
- API keys should be kept secret and rotated periodically

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| APEX_API_KEY | Yes | - | API key for authentication |
| APEX_ENGINE_URL | Yes | - | URL of ApexContent Engine |
| BASE_URL | Yes | - | Public URL of this website |
| PORT | No | 3000 | Server port |
| STORAGE_PATH | No | ./uploads | Media storage directory |
| DEBUG | No | false | Enable debug logging |

## License

MIT
