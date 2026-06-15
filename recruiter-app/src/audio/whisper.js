async function transcribe(audioBuffer) {
  const apiKey = process.env.OPENAI_API_KEY || '';
  if (!apiKey) throw new Error('OpenAI transcription key is not configured.');

  const form = new FormData();
  form.append('file', new Blob([audioBuffer], { type: 'audio/webm' }), 'audio.webm');
  form.append('model', 'whisper-1');
  form.append('response_format', 'json');
  form.append('language', 'en');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  });

  if (!response.ok) throw new Error(`OpenAI transcription failed (${response.status}).`);
  const result = await response.json();
  return result.text || '';
}

module.exports = { transcribe };
