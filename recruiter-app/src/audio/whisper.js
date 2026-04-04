const OpenAI = require('openai');
const { Readable } = require('stream');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'dummy_key' });

async function transcribe(audioBuffer) {
  const readable = new Readable();
  readable.push(audioBuffer);
  readable.push(null);
  readable.path = 'audio.webm';

  const response = await openai.audio.transcriptions.create({
    file: readable,
    model: 'whisper-1',
    response_format: 'json',
    language: 'en'
  });

  return response.text;
}

module.exports = { transcribe };
