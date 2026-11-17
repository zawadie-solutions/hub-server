// The OpenAI calls behind "Explain it back" and "Check my work" (see checks.js).
const OpenAI = require('openai');
const env = require('../config/env');
const { explainPrompt, normalizeExplain, workPrompt, normalizeWork } = require('./checks');

const MODEL = 'gpt-4o';

let openai = null;
const client = () => (openai = openai || new OpenAI({ apiKey: env.OPENAI_API_KEY }));

// image: { buffer, mimetype } sent alongside the prompt, for the model to look at.
async function askJson(prompt, image = null) {
  const content = image
    ? [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:${image.mimetype};base64,${image.buffer.toString('base64')}`, detail: 'high' } }
      ]
    : prompt;
  const response = await client().chat.completions.create({
    model: MODEL,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content }]
  });
  return JSON.parse(response.choices[0].message.content);
}

async function checkExplanation(assignment, explanation) {
  return normalizeExplain(await askJson(explainPrompt(assignment, explanation)), assignment);
}

/** workText: the work, or notes about the image. image: { buffer, mimetype } when the work is an image. */
async function checkWork(assignment, workText, image = null) {
  const hasImage = Boolean(image);
  return normalizeWork(await askJson(workPrompt(assignment, workText, { hasImage }), image), assignment, workText, { hasImage });
}

module.exports = { checkExplanation, checkWork };
