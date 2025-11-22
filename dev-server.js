import express from 'express';
import 'dotenv/config';

const app = express();
app.use(express.json());

// API endpoint that mimics the Vercel serverless function
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, system, model = 'claude-3-5-sonnet-20241022' } = req.body;

    const ANTHROPIC_API_KEY = process.env.VITE_ANTHROPIC_API_KEY;

    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'API key not configured. Please set VITE_ANTHROPIC_API_KEY in .env file' });
    }

    console.log(`📤 Request: model=${model}, messages=${messages.length}`);

    // Make request to Anthropic API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': ANTHROPIC_API_KEY,
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 4096,
        system: system,
        messages: messages,
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return res.status(response.status).json({ error: `API Error: ${response.status} - ${error}` });
    }

    // Set headers for streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Pipe the response body directly to the client
    response.body.pipeTo(
      new WritableStream({
        write(chunk) {
          res.write(chunk);
        },
        close() {
          res.end();
        },
        abort(err) {
          console.error('Stream error:', err);
          res.end();
        },
      })
    );
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 Dev API server running on http://localhost:${PORT}`);
  console.log(`📡 API endpoint: http://localhost:${PORT}/api/chat\n`);
});
