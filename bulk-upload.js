const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// 1. Load Environment Variables from .env file
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      // Remove comments and whitespace
      const cleanLine = line.trim();
      if (!cleanLine || cleanLine.startsWith('#')) return;

      const idx = cleanLine.indexOf('=');
      if (idx > -1) {
        const key = cleanLine.substring(0, idx).trim();
        const val = cleanLine.substring(idx + 1).trim().replace(/^['"]|['"]$/g, ''); // strip optional quotes
        process.env[key] = val;
      }
    });
    console.log('✔ Environment variables loaded from .env');
  } else {
    console.error('❌ Error: .env file not found in current directory.');
    process.exit(1);
  }
}

loadEnv();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Error: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in your .env file.');
  process.exit(1);
}

// 2. Initialize Supabase
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// 3. Define directories
const imagesDir = path.join(__dirname, 'bulk-images');
const metadataFile = path.join(imagesDir, 'metadata.json');

// Helper to convert filename to readable name: e.g. "monsoon-reverie.jpg" -> "Monsoon Reverie"
function cleanName(filename) {
  const nameWithoutExt = path.parse(filename).name;
  return nameWithoutExt
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

async function startBulkUpload() {
  // Check if bulk-images directory exists
  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir);
    console.log(`\n📁 Created a folder named "bulk-images" at: ${imagesDir}`);
    console.log('👉 Please drop your 85 images in that folder and run this script again!');
    console.log('💡 Option: You can also place a "metadata.json" inside that folder to define custom titles/descriptions.');
    process.exit(0);
  }

  // Read files from directory
  const files = fs.readdirSync(imagesDir).filter(file => {
    const ext = path.extname(file).toLowerCase();
    return ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext);
  });

  if (files.length === 0) {
    console.log(`\n📂 Folder "bulk-images" is empty.`);
    console.log(`👉 Please copy your images to: ${imagesDir}`);
    console.log('Then run: node bulk-upload.js');
    process.exit(0);
  }

  console.log(`\n🚀 Found ${files.length} images. Starting bulk upload...`);

  // Load metadata.json if it exists
  let metadataList = [];
  if (fs.existsSync(metadataFile)) {
    try {
      metadataList = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
      console.log('✔ Loaded metadata.json configurations');
    } catch (e) {
      console.warn('⚠ Warning: Failed to parse metadata.json. Default values will be used. Error:', e.message);
    }
  }

  // Ensure public Storage Bucket exists
  try {
    console.log('🔄 Ensuring Supabase Storage bucket "paintings" exists...');
    await supabase.storage.createBucket('paintings', { public: true });
  } catch (err) {
    // Ignore error if it already exists
  }

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < files.length; i++) {
    const filename = files[i];
    const filePath = path.join(imagesDir, filename);

    console.log(`\n[${i + 1}/${files.length}] Processing "${filename}"...`);

    try {
      // Find matching metadata from json, or fallback to defaults
      const meta = metadataList.find(m => m.filename === filename) || {};

      const paintingName = meta.name || cleanName(filename);
      const style = (meta.style || 'nature').toLowerCase().trim();
      const mood = (meta.mood || 'calm').toLowerCase().trim();
      const size = (meta.size || 'medium').toLowerCase().trim();
      const color = (meta.color || 'warm').toLowerCase().trim();
      const dims = meta.dims || '18" × 24"';
      const desc = meta.desc || 'Original artwork.';
      const featured = typeof meta.featured === 'boolean' ? meta.featured : false;
      const isNew = typeof meta.isNew === 'boolean' ? meta.isNew : true;
      const likes = typeof meta.likes === 'number' ? meta.likes : 0;

      // Read file buffer
      const fileBuffer = fs.readFileSync(filePath);
      const extension = path.extname(filename).slice(1);
      const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${extension}`;
      const storagePath = `uploads/${uniqueName}`;

      // 1. Upload to Supabase Storage
      const mimeType = `image/${extension === 'jpg' ? 'jpeg' : extension}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('paintings')
        .upload(storagePath, fileBuffer, {
          contentType: mimeType,
          upsert: true
        });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('paintings')
        .getPublicUrl(storagePath);

      const publicUrl = urlData.publicUrl;
      console.log(`  ✔ Uploaded to Storage: ${publicUrl}`);

      // 2. Insert record into Supabase PostgreSQL Database
      const { data: dbData, error: dbError } = await supabase
        .from('paintings')
        .insert([{
          name: paintingName,
          price: 0, // default price is 0
          style: style,
          mood: mood,
          size: size,
          color: color,
          dims: dims,
          img: publicUrl,
          desc: desc,
          featured: featured,
          is_new: isNew,
          likes: likes
        }])
        .select('*');

      if (dbError) throw dbError;

      console.log(`  ✔ Inserted into Database: "${paintingName}" under category "${style}"`);
      successCount++;
    } catch (error) {
      console.error(`  ❌ Error processing "${filename}":`, error.message);
      failCount++;
    }
  }

  console.log(`\n🎉 Bulk upload completed!`);
  console.log(`=========================`);
  console.log(`✔ Successful: ${successCount}`);
  console.log(`❌ Failed:     ${failCount}`);
  console.log(`=========================`);
  console.log(`👉 Commit your project changes and push to GitHub so your website is updated!`);
}

startBulkUpload();
