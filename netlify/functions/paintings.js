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

// Initial Seed Data
const defaultPaintings = [
  { name: "Monsoon Reverie", price: 8500, style: "abstract", mood: "calm", size: "medium", color: "cool", dims: '18" × 24"', img: "https://images.unsplash.com/photo-1541701494587-cb58502866ab?w=600&q=80", desc: "A dreamy wash of blues and grays evoking the first rains of the season.", featured: true, is_new: true },
  { name: "Crimson Garden", price: 12000, style: "floral", mood: "vibrant", size: "large", color: "warm", dims: '24" × 36"', img: "https://images.unsplash.com/photo-1549887534-1541e8503d97?w=600&q=80", desc: "Lush florals in deep reds and blush pinks, painted with bold, expressive strokes.", featured: true, is_new: true },
  { name: "Golden Hour Portrait", price: 15500, style: "portrait", mood: "romantic", size: "medium", color: "golden", dims: '16" × 20"', img: "https://images.unsplash.com/photo-1578301978693-85fa9c0320b9?w=600&q=80", desc: "A soft portrait bathed in the warmth of a setting sun.", featured: true, is_new: false },
  { name: "Midnight Geometry", price: 9800, style: "geometric", mood: "dark", size: "small", color: "mono", dims: '12" × 12"', img: "https://images.unsplash.com/photo-1504608524841-42584120d693?w=600&q=80", desc: "Sharp forms and deep shadows explore structure in monochrome.", featured: false, is_new: true },
  { name: "Meadow Song", price: 7200, style: "landscape", mood: "calm", size: "large", color: "green", dims: '30" × 20"', img: "https://images.unsplash.com/photo-1465146344425-f00d5f5c8f07?w=600&q=80", desc: "A peaceful countryside scene in soft greens and morning light.", featured: true, is_new: false },
  { name: "Sakura Drift", price: 11000, style: "floral", mood: "romantic", size: "medium", color: "warm", dims: '18" × 24"', img: "https://images.unsplash.com/photo-1490750967868-88df5691cc44?w=600&q=80", desc: "Cherry blossoms caught mid-fall, delicate and ephemeral.", featured: false, is_new: true },
  { name: "Azure Dream", price: 6500, style: "abstract", mood: "calm", size: "small", color: "cool", dims: '10" × 10"', img: "https://images.unsplash.com/photo-1557672172-298e090bd0f1?w=600&q=80", desc: "A tranquil study in soft blues and cerulean washes.", featured: false, is_new: false },
  { name: "Bold Sun", price: 14000, style: "abstract", mood: "bold", size: "large", color: "golden", dims: '36" × 36"', img: "https://images.unsplash.com/photo-1509909756405-be0199881695?w=600&q=80", desc: "Energetic swirls of amber and gold radiate warmth and power.", featured: false, is_new: true }
];

exports.handler = async (event, context) => {
  const method = event.httpMethod;
  const pathParts = event.path.split('/');
  const lastPart = pathParts[pathParts.length - 1];
  const isLikeRoute = lastPart === 'like';
  const id = !isLikeRoute && lastPart !== 'paintings' ? parseInt(lastPart) : null;

  // Set standard response headers (CORS & Content-Type)
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
  };

  if (method === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    if (method === 'GET') {
      // 1. Fetch paintings
      let { data, error } = await supabase
        .from('paintings')
        .select('*')
        .order('id', { ascending: true });

      if (error) throw error;

      // 2. If empty, auto-seed the database
      if (!data || data.length === 0) {
        const { data: seeded, error: seedError } = await supabase
          .from('paintings')
          .insert(defaultPaintings)
          .select('*');

        if (seedError) throw seedError;
        data = seeded;
      }

      // Convert is_new to isNew for frontend compatibility
      const formatted = data.map(p => ({
        id: p.id,
        name: p.name,
        price: p.price,
        style: p.style,
        mood: p.mood,
        size: p.size,
        color: p.color,
        dims: p.dims,
        img: p.img,
        desc: p.desc,
        featured: p.featured,
        isNew: p.is_new,
        likes: p.likes || 0
      }));

      return { statusCode: 200, headers, body: JSON.stringify(formatted) };
    }

    // Public endpoint for liking a painting (no admin authentication needed)
    if (method === 'POST' && isLikeRoute) {
      const payload = JSON.parse(event.body);
      const paintingId = parseInt(payload.id);
      if (isNaN(paintingId)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid painting ID" }) };
      }

      let data;
      // 1. Try calling increment_likes RPC
      let { data: rpcData, error: rpcError } = await supabase.rpc('increment_likes', { row_id: paintingId });

      if (rpcError) {
        console.warn(`RPC increment_likes failed, trying fallback: ${rpcError.message}`);
        // 2. Fallback: fetch current, increment, and update
        const { data: p, error: fetchErr } = await supabase
          .from('paintings')
          .select('likes')
          .eq('id', paintingId)
          .single();

        if (fetchErr) throw fetchErr;

        const newLikes = (p.likes || 0) + 1;
        const { data: updated, error: updateErr } = await supabase
          .from('paintings')
          .update({ likes: newLikes })
          .eq('id', paintingId)
          .select('*')
          .single();

        if (updateErr) throw updateErr;
        data = updated;
      } else {
        // Fetch the updated painting to return
        const { data: updated, error: fetchErr } = await supabase
          .from('paintings')
          .select('*')
          .eq('id', paintingId)
          .single();
        if (!fetchErr) {
          data = updated;
        } else {
          throw fetchErr;
        }
      }

      const formatted = {
        id: data.id,
        name: data.name,
        price: data.price,
        style: data.style,
        mood: data.mood,
        size: data.size,
        color: data.color,
        dims: data.dims,
        img: data.img,
        desc: data.desc,
        featured: data.featured,
        isNew: data.is_new,
        likes: data.likes || 0
      };

      return { statusCode: 200, headers, body: JSON.stringify(formatted) };
    }

    // All other endpoints require Admin Authentication
    if (!isAuthorized(event.headers)) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: "Unauthorized" }) };
    }

    if (method === 'POST') {
      const payload = JSON.parse(event.body);
      const row = {
        name: payload.name,
        price: payload.price,
        style: payload.style,
        mood: payload.mood,
        size: payload.size,
        color: payload.color,
        dims: payload.dims,
        img: payload.img,
        desc: payload.desc,
        featured: payload.featured,
        is_new: payload.isNew
      };

      const { data, error } = await supabase
        .from('paintings')
        .insert([row])
        .select('*')
        .single();

      if (error) throw error;
      
      const formatted = {
        id: data.id,
        name: data.name,
        price: data.price,
        style: data.style,
        mood: data.mood,
        size: data.size,
        color: data.color,
        dims: data.dims,
        img: data.img,
        desc: data.desc,
        featured: data.featured,
        isNew: data.is_new,
        likes: data.likes || 0
      };

      return { statusCode: 201, headers, body: JSON.stringify(formatted) };
    }

    if (method === 'PUT') {
      if (!id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing ID in URL" }) };
      }
      const payload = JSON.parse(event.body);
      const row = {
        name: payload.name,
        price: payload.price,
        style: payload.style,
        mood: payload.mood,
        size: payload.size,
        color: payload.color,
        dims: payload.dims,
        img: payload.img,
        desc: payload.desc,
        featured: payload.featured,
        is_new: payload.isNew
      };
      if (typeof payload.likes === 'number') {
        row.likes = payload.likes;
      }

      const { data, error } = await supabase
        .from('paintings')
        .update(row)
        .eq('id', id)
        .select('*')
        .single();

      if (error) throw error;

      const formatted = {
        id: data.id,
        name: data.name,
        price: data.price,
        style: data.style,
        mood: data.mood,
        size: data.size,
        color: data.color,
        dims: data.dims,
        img: data.img,
        desc: data.desc,
        featured: data.featured,
        isNew: data.is_new,
        likes: data.likes || 0
      };

      return { statusCode: 200, headers, body: JSON.stringify(formatted) };
    }

    if (method === 'DELETE') {
      if (!id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing ID in URL" }) };
      }

      const { error } = await supabase
        .from('paintings')
        .delete()
        .eq('id', id);

      if (error) throw error;

      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method Not Allowed" }) };

  } catch (error) {
    console.error("Database Error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || "Internal Server Error" })
    };
  }
};
