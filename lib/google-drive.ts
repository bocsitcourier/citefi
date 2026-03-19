import { google } from 'googleapis';
import { Readable } from 'stream';

interface GoogleDriveConfig {
  enabled: boolean;
  serviceAccountEmail?: string;
  serviceAccountKey?: string;
  folderId?: string;
}

function getConfig(): GoogleDriveConfig {
  const enabled = process.env.GOOGLE_DRIVE_ENABLED === 'true';
  const serviceAccountEmail = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL;
  const serviceAccountKey = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY;
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  return {
    enabled,
    serviceAccountEmail,
    serviceAccountKey,
    folderId,
  };
}

export async function uploadPodcastToDrive(
  fileBuffer: Buffer,
  fileName: string,
  metadata: {
    articleTitle: string;
    articleId: string;
    duration?: number | null;
  }
): Promise<string | null> {
  const config = getConfig();

  if (!config.enabled) {
    console.log('[Google Drive] Upload disabled - skipping');
    return null;
  }

  if (!config.serviceAccountKey || !config.folderId) {
    console.warn('[Google Drive] Missing credentials or folder ID - skipping upload');
    return null;
  }

  try {
    const credentials = JSON.parse(config.serviceAccountKey);

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });

    const drive = google.drive({ version: 'v3', auth });

    const fileMetadata = {
      name: fileName,
      parents: [config.folderId],
      description: `Podcast for article: ${metadata.articleTitle} (ID: ${metadata.articleId})${metadata.duration ? ` - Duration: ${Math.floor(metadata.duration / 60)}:${String(Math.floor(metadata.duration % 60)).padStart(2, '0')}` : ''}`,
    };

    const media = {
      mimeType: 'audio/mpeg',
      body: Readable.from(fileBuffer),
    };

    console.log(`[Google Drive] Uploading podcast: ${fileName}`);

    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, name, webViewLink, webContentLink',
    });

    const fileId = response.data.id;
    const webViewLink = response.data.webViewLink;

    console.log(`[Google Drive] Upload successful!`);
    console.log(`[Google Drive] File ID: ${fileId}`);
    console.log(`[Google Drive] View Link: ${webViewLink}`);

    return fileId || null;
  } catch (error) {
    console.error('[Google Drive] Upload failed:', error);
    if (error instanceof Error) {
      console.error('[Google Drive] Error details:', error.message);
    }
    return null;
  }
}

export async function testConnection(): Promise<boolean> {
  const config = getConfig();

  if (!config.enabled) {
    console.log('[Google Drive] Integration is disabled');
    return false;
  }

  if (!config.serviceAccountKey || !config.folderId) {
    console.error('[Google Drive] Missing credentials or folder ID');
    return false;
  }

  try {
    const credentials = JSON.parse(config.serviceAccountKey);

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });

    const drive = google.drive({ version: 'v3', auth });

    const response = await drive.files.get({
      fileId: config.folderId,
      fields: 'id, name, mimeType',
    });

    console.log('[Google Drive] Connection successful!');
    console.log('[Google Drive] Target folder:', response.data.name);
    
    return true;
  } catch (error) {
    console.error('[Google Drive] Connection test failed:', error);
    if (error instanceof Error) {
      console.error('[Google Drive] Error details:', error.message);
    }
    return false;
  }
}
