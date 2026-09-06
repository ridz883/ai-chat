export const config = {
  runtime: 'nodejs',
};

// Rate limiting in-memory: Maksimal 15 request per menit per IP
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 menit
const MAX_REQUESTS = 15;

function checkRateLimit(ip) {
  const now = Date.now();
  const clientData = rateLimitMap.get(ip) || { count: 0, startTime: now };

  if (now - clientData.startTime > RATE_LIMIT_WINDOW) {
    clientData.count = 1;
    clientData.startTime = now;
  } else {
    clientData.count += 1;
  }

  rateLimitMap.set(ip, clientData);

  // Bersihkan cache lama berkala
  if (rateLimitMap.size > 1000) {
    for (const [storedIp, data] of rateLimitMap.entries()) {
      if (now - data.startTime > RATE_LIMIT_WINDOW) {
        rateLimitMap.delete(storedIp);
      }
    }
  }

  return clientData.count <= MAX_REQUESTS;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Identifikasi IP client
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';

  if (!checkRateLimit(clientIp)) {
    return res.status(429).json({
      error: 'Terlalu banyak permintaan (Rate limit tercapai). Tunggu 1 menit sebelum mengirim pesan lagi.'
    });
  }

  const apiKey = "sk-xt-f8c8a9432ddccf472ad7210961813d6d62f1a28e98f4440b";
  const { messages, model, temperature } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Messages payload is required' });
  }

  const selectedModel = model || 'qwen/qwen3.8-max:free';
  const selectedTemp = typeof temperature === 'number' ? temperature : 0.7;

  try {
    const upstreamResponse = await fetch('https://api.xkiro.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: messages,
        temperature: selectedTemp,
        stream: true,
      }),
    });

    if (!upstreamResponse.ok) {
      const errText = await upstreamResponse.text();
      return res.status(upstreamResponse.status).json({
        error: `Provider Error (${upstreamResponse.status}): ${errText}`,
      });
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');

    const reader = upstreamResponse.body.getReader();
    const decoder = new TextDecoder('utf-8');

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }

    res.end();
  } catch (error) {
    console.error('API Error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Internal Server Error' });
    } else {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  }
}
