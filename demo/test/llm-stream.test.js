'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const LlmService = require('../app/service/llm');

test('streams structured content counts without exposing reasoning fields', async () => {
  const frames = [
    { choices: [ { delta: { reasoning_content: 'private reasoning' } } ] },
    { choices: [ { delta: { content: '{"assets":' } } ] },
    { choices: [ { delta: { content: '[],"relations":[],"risks":[],"questions":[]}' } } ] }
  ];
  const encoded = new TextEncoder().encode(frames.map(frame => 'data: ' + JSON.stringify(frame) + '\n\n').join('') + 'data: [DONE]\n\n');
  const stream = new ReadableStream({
    start(controller) {
      for (let offset = 0; offset < encoded.length; offset += 11) controller.enqueue(encoded.slice(offset, offset + 11));
      controller.close();
    }
  });
  const response = new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
  const service = Object.create(LlmService.prototype);
  const progress = [];

  const result = await service.readCompletionStream(response, update => progress.push(update));

  assert.equal(result, '{"assets":[],"relations":[],"risks":[],"questions":[]}');
  assert.equal(result.includes('private reasoning'), false);
  assert.ok(progress.length > 0);
  assert.equal(progress.at(-1).responseChars, result.length);
});
