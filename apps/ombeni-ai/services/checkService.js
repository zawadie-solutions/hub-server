// The OpenAI calls behind "Explain it back" and "Check my work" (see checks.js).
const OpenAI = require('openai');
const env = require('../config/env');
const { explainPrompt, normalizeExplain, workPrompt, normalizeWork } = require('./checks');

const MODEL = 'gpt-4o';

let openai = null;
const client = () => (openai = openai || new OpenAI({ apiKey: env.OPENAI_API_KEY }));

async function askJson(prompt) {
  const response = await client().chat.completions.create({
    model: MODEL,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: prompt }]
  });
  return JSON.parse(response.choices[0].message.content);
}

async function checkExplanation(assignment, explanation) {
  return normalizeExplain(await askJson(explainPrompt(assignment, explanation)), assignment);
}

async function checkWork(assignment, workText) {
  return normalizeWork(await askJson(workPrompt(assignment, workText)), assignment, workText);
}

module.exports = { checkExplanation, checkWork };
