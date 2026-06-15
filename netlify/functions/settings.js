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

// Initial Seed Settings
const defaultSettings = {
  wa: "+919876543210",
  email: "hello@byflaminggo.com",
  insta: "@byflaminggo",
  heroTitle: "Art that speaks\nto your walls",
  heroSub: "Curated paintings and portraits delivered to your home. Browse, fall in love, and reach out — we'll do the rest.",
  faqs: [
    { q: "How do I place an order?", a: "Simply browse our collection, find a piece you love, and tap the WhatsApp button. We'll handle everything from there." },
    { q: "Do you ship across India?", a: "Yes! We ship to all major cities across India. Shipping costs and timelines vary by location — ask us on WhatsApp." },
    { q: "Can I commission a custom portrait?", a: "Absolutely. We love custom work. Share your idea with us on WhatsApp and we'll work through the details together." }
  ]
};

exports.handler = async (event, context) => {
  const method = event.httpMethod;

  // Set standard response headers
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };

  if (method === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    if (method === 'GET') {
      let { data, error } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'site_settings')
        .single();

      // Seed if settings do not exist
      if (error && error.code === 'PGRST116') {
        const { data: seeded, error: seedError } = await supabase
          .from('settings')
          .insert([{ key: 'site_settings', value: defaultSettings }])
          .select('value')
          .single();

        if (seedError) throw seedError;
        data = seeded;
      } else if (error) {
        throw error;
      }

      return { statusCode: 200, headers, body: JSON.stringify(data.value) };
    }

    if (method === 'POST') {
      // POST requires Admin Authentication
      if (!isAuthorized(event.headers)) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: "Unauthorized" }) };
      }

      const payload = JSON.parse(event.body);

      const { data, error } = await supabase
        .from('settings')
        .upsert({ key: 'site_settings', value: payload, updated_at: new Date() })
        .select('value')
        .single();

      if (error) throw error;

      return { statusCode: 200, headers, body: JSON.stringify(data.value) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method Not Allowed" }) };

  } catch (error) {
    console.error("Database Error settings.js:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || "Internal Server Error" })
    };
  }
};
