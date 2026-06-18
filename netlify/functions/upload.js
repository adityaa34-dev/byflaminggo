const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase Client
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Helper to check Auth
const isAuthorized = (headers) => {
  const authHeader = headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.substring(7);
  return token === process.env.ADMIN_PASSWORD;
};

exports.handler = async (event, context) => {
  const method = event.httpMethod;

  // Set standard response headers
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (method === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    if (method !== 'POST') {
      return { statusCode: 405, headers, body: JSON.stringify({ error: "Method Not Allowed" }) };
    }

    // Check Auth
    if (!isAuthorized(event.headers)) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: "Unauthorized" }) };
    }

    const payload = JSON.parse(event.body);
    const { fileName, fileType, fileData } = payload;

    if (!fileName || !fileType || !fileData) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing required fields (fileName, fileType, fileData)" }) };
    }

    // Convert Base64 string back to binary Buffer
    const base64Data = fileData.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, 'base64');

    // Create unique file path: timestamp-hash.ext
    const extension = fileName.split('.').pop();
    const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${extension}`;
    const filePath = `uploads/${uniqueName}`;

    // Ensure the bucket 'paintings' exists and is public
    try {
      await supabase.storage.createBucket('paintings', { public: true });
    } catch (bucketErr) {
      // Ignore if bucket already exists or failed
    }

    // Upload to Supabase Storage bucket 'paintings'
    const { data, error } = await supabase.storage
      .from('paintings')
      .upload(filePath, buffer, {
        contentType: fileType,
        upsert: true
      });

    if (error) throw error;

    // Get public URL
    const { data: publicUrlData } = supabase.storage
      .from('paintings')
      .getPublicUrl(filePath);

    const publicUrl = publicUrlData.publicUrl;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ publicUrl })
    };

  } catch (error) {
    console.error("Storage Upload Error upload.js:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || "Internal Server Error" })
    };
  }
};
