import sharp from "sharp";

export interface GeneratedImage {
  imageData: Buffer;
  prompt: string;
}

export async function generateImage(prompt: string): Promise<Buffer> {
  console.log(`🎨 Generating image: "${prompt.substring(0, 60)}..."`);

  const placeholderSvg = `
    <svg width="1200" height="800" xmlns="http://www.w3.org/2000/svg">
      <rect width="1200" height="800" fill="#6C5CE7"/>
      <text x="50%" y="50%" font-family="Arial" font-size="24" fill="white" text-anchor="middle">
        Image Placeholder: ${prompt.substring(0, 50)}
      </text>
    </svg>
  `;

  const webpBuffer = await sharp(Buffer.from(placeholderSvg))
    .webp({ quality: 85 })
    .resize(1200, 800, {
      fit: "cover",
      position: "center",
    })
    .toBuffer();

  console.log(`✅ Placeholder image generated (WebP)`);
  return webpBuffer;
}

export async function generateImages(prompts: string[]): Promise<GeneratedImage[]> {
  console.log(`🎨 Generating ${prompts.length} placeholder images...`);

  const results: GeneratedImage[] = [];

  for (let i = 0; i < prompts.length; i++) {
    try {
      const imageData = await generateImage(prompts[i]);
      results.push({
        imageData,
        prompt: prompts[i],
      });
      console.log(`✅ Generated placeholder image ${i + 1}/${prompts.length}`);
    } catch (error) {
      console.error(`❌ Failed to generate image ${i + 1}:`, error);
      throw error;
    }
  }

  return results;
}
