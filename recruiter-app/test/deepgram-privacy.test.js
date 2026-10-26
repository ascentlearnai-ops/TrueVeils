const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

test('Deepgram fallback speech request opts out of model improvement', async () => {
  const inputPath = path.join(__dirname, 'synthetic-audio.wav');
  const audio = Buffer.from('synthetic-audio');
  const apiKey = 'synthetic-provider-key';
  const requests = [];
  const statuses = [];
  const source = path.join(__dirname, '../src/audio/deepgram-transcriber.js');
  const module = { exports: {} };
  const dependencies = {
    fs: {
      existsSync: filename => filename === inputPath,
      readFileSync: filename => {
        assert.equal(filename, inputPath);
        return audio;
      },
    },
    path,
    https: {
      request: (options, onResponse) => {
        requests.push(options);
        const request = new EventEmitter();
        request.end = body => {
          assert.equal(body, audio);
          const response = new EventEmitter();
          response.statusCode = 200;
          onResponse(response);
          response.emit('data', Buffer.from(JSON.stringify({
            results: { channels: [{ alternatives: [{ transcript: 'Synthetic transcript.', confidence: 0.9 }] }] },
          })));
          response.emit('end');
        };
        return request;
      },
    },
    '../ai/transcript-quality': require('../src/ai/transcript-quality'),
  };
  // Run the actual adapter with an allowlisted I/O boundary; no file or network audio.
  vm.runInNewContext(fs.readFileSync(source, 'utf8'), {
    module,
    Buffer,
    require: name => {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  }, { filename: source });

  const transcriber = new module.exports.DeepgramTranscriber({ apiKey, onStatus: status => statuses.push(status) });
  const result = await transcriber.transcribe(inputPath, { sequence: 0, chunkId: 'synthetic-chunk' });
  assert.equal(requests.length, 1);
  const request = requests[0];
  const url = new URL(request.path, `https://${request.hostname}`);
  assert.equal(url.origin, 'https://api.deepgram.com');
  assert.equal(url.pathname, '/v1/listen');
  assert.deepEqual(url.searchParams.getAll('mip_opt_out'), ['true']);
  assert.equal(url.searchParams.get('model'), 'nova-3');
  assert.equal(url.searchParams.get('language'), 'en');
  for (const option of ['smart_format', 'punctuate', 'filler_words']) {
    assert.equal(url.searchParams.get(option), 'true', option);
  }
  assert.ok(!url.href.includes(apiKey));
  assert.equal(request.method, 'POST');
  assert.equal(request.headers.Authorization, `Token ${apiKey}`);
  assert.equal(request.headers['Content-Type'], 'audio/wav');
  assert.equal(request.headers['Content-Length'], audio.length);
  assert.equal(request.timeout, 45000);
  assert.equal(result.ok, true);
  assert.equal(result.text, 'Synthetic transcript.');
  assert.equal(result.confidence, 0.9);
  assert.equal(result.lowConfidenceWordRatio, null);
  assert.deepEqual(statuses.map(status => status.state), ['transcribing', 'ready']);
});
