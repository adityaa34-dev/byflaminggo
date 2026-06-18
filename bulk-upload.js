const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

// 1. Load Environment Variables from .env file
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const cleanLine = line.trim();
      if (!cleanLine || cleanLine.startsWith('#')) return;

      const idx = cleanLine.indexOf('=');
      if (idx > -1) {
        const key = cleanLine.substring(0, idx).trim();
        const val = cleanLine.substring(idx + 1).trim().replace(/^['"]|['"]$/g, ''); // strip quotes
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
const excelFile = path.join(__dirname, 'byflaminggo_painting_catalog.xlsx');
const imagesDir = path.join(__dirname, 'byflaminggo_renamed_paintings');

// Mappers for columns
function mapSize(sizeStr) {
  const s = (sizeStr || '').toLowerCase();
  if (s.includes('large') || s.includes('24') || s.includes('36') || s.includes('48')) return 'large';
  if (s.includes('small') || s.includes('12')) return 'small';
  return 'medium'; // default fallback
}

function mapColor(colorStr) {
  const c = (colorStr || '').toLowerCase();
  if (c.includes('gold') || c.includes('amber') || c.includes('yellow') || c.includes('orange')) return 'golden';
  if (c.includes('green') || c.includes('emerald') || c.includes('olive')) return 'green';
  if (c.includes('blue') || c.includes('teal') || c.includes('azure') || c.includes('indigo') || c.includes('cyan')) return 'cool';
  if (c.includes('red') || c.includes('crimson') || c.includes('pink') || c.includes('rose') || c.includes('sienna') || c.includes('burnt')) return 'warm';
  if (c.includes('black') || c.includes('ebony') || c.includes('dark') || c.includes('grey') || c.includes('gray') || c.includes('charcoal')) return 'mono';
  if (c.includes('white') || c.includes('ivory') || c.includes('cream') || c.includes('light')) return 'light';
  return 'light'; // default fallback
}

function mapMood(moodStr) {
  const m = (moodStr || '').toLowerCase();
  if (m.includes('vibrant') || m.includes('energetic') || m.includes('vivid') || m.includes('bright') || m.includes('intense')) return 'vibrant';
  if (m.includes('bold') || m.includes('dramatic') || m.includes('powerful')) return 'bold';
  if (m.includes('dark') || m.includes('midnight') || m.includes('somber') || m.includes('shadow')) return 'dark';
  if (m.includes('romantic') || m.includes('peaceful') || m.includes('serene') || m.includes('soft') || m.includes('gentle')) return 'romantic';
  return 'calm'; // default fallback (covers devotional, calm, spiritual, etc.)
}

async function startBulkUpload() {
  // Check if Excel catalog file exists
  if (!fs.existsSync(excelFile)) {
    console.error(`❌ Error: Excel catalog file not found at: ${excelFile}`);
    process.exit(1);
  }

  // Check if paintings directory exists
  if (!fs.existsSync(imagesDir)) {
    console.error(`❌ Error: Image folder "byflaminggo_renamed_paintings" not found at: ${imagesDir}`);
    process.exit(1);
  }

  // Read Excel workbook
  console.log(`\n📖 Reading Excel file: ${excelFile}...`);
  const workbook = XLSX.readFile(excelFile);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet);

  if (rows.length === 0) {
    console.error('❌ Error: The Excel file contains 0 rows of data.');
    process.exit(1);
  }

  console.log(`🚀 Found ${rows.length} rows in Excel. Matching with image files...`);

  // Ensure public Storage Bucket exists
  try {
    console.log('🔄 Ensuring Supabase Storage bucket "paintings" exists...');
    await supabase.storage.createBucket('paintings', { public: true });
  } catch (err) {
    // Ignore error if it already exists
  }

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const filename = row['New Filename'] || row['New FileName'];
    
    if (!filename) {
      console.warn(`\n⚠ [${i + 1}/${rows.length}] Warning: Row has no "New Filename" defined. Skipping.`);
      failCount++;
      continue;
    }

    const filePath = path.join(imagesDir, filename);
    console.log(`\n[${i + 1}/${rows.length}] Processing "${filename}"...`);

    if (!fs.existsSync(filePath)) {
      console.error(`  ❌ Error: File not found in images directory: ${filePath}`);
      failCount++;
      continue;
    }

    try {
      const paintingName = row['Painting Name'] || filename;
      const style = (row['Style / Category'] || 'General').trim();
      const mood = mapMood(row['Mood']);
      const size = mapSize(row['Size']);
      const color = mapColor(row['Colour Palette'] || row['Color Palette']);
      const dims = row['Dimensions'] || '18" × 24"';
      const desc = row['Description'] || 'Original artwork.';
      
      // Feature the first 8 paintings for a beautiful homepage setup
      const featured = (row['No.'] || (i + 1)) <= 8; 
      const isNew = true; // Mark all uploaded items as new arrivals

      // Read file buffer
      const fileBuffer = fs.readFileSync(filePath);
      const extension = path.extname(filename).slice(1);
      const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${extension}`;
      const storagePath = `uploads/${uniqueName}`;

      // 1. Upload to Supabase Storage
      const mimeType = `image/${extension === 'jpg' ? 'jpeg' : (extension === 'png' ? 'png' : 'jpeg')}`;
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
      console.log(`  ✔ Uploaded Image to Storage: ${publicUrl}`);

      // 2. Insert record into Supabase PostgreSQL Database
      const { data: dbData, error: dbError } = await supabase
        .from('paintings')
        .insert([{
          name: paintingName,
          price: 0,
          style: style,
          mood: mood,
          size: size,
          color: color,
          dims: dims,
          img: publicUrl,
          desc: desc,
          featured: featured,
          is_new: isNew,
          likes: 0
        }])
        .select('*');

      if (dbError) throw dbError;

      console.log(`  ✔ Saved Database Entry: "${paintingName}" under style "${style}"`);
      successCount++;
    } catch (error) {
      console.error(`  ❌ Error:`, error.message);
      failCount++;
    }
  }

  console.log(`\n🎉 Bulk upload completed!`);
  console.log(`=========================`);
  console.log(`✔ Successful: ${successCount}`);
  console.log(`❌ Failed:     ${failCount}`);
  console.log(`=========================`);
  console.log(`👉 Please deploy your updates so your website connects to the uploaded paintings!`);
}

startBulkUpload();
