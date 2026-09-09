class MiniMaxError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'MiniMaxError';
    this.status = status;
  }
}

const SYSTEM = `
You are a conservative reviewer for a medical prescription processing system.

You receive:
1. extracted prescription information from a vision model
2. a separate visual document review

Your job is to identify contradictions or reasons a human should review the document.

You must not:
- provide medical advice
- recommend medicine substitutions
- change dosage
- claim the document is definitely real or fake
- claim an image was definitely AI-generated

Return JSON only.
`;

function extractJson(text) {
  if (!text) {
    throw new MiniMaxError(
      'MiniMax returned an empty response',
      502
    );
  }

  const cleaned = String(text)
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');

    if (start !== -1 && end !== -1) {
      try {
        return JSON.parse(
          cleaned.slice(start, end + 1)
        );
      } catch {
        // handled below
      }
    }

    throw new MiniMaxError(
      'MiniMax returned invalid JSON',
      502
    );
  }
}

async function minimaxReview({
  prescription,
  visualReview,
}) {
  const apiKey =
    process.env.MINIMAX_API_KEY;

  if (!apiKey) {
    return {
      available: false,
      reason: 'MINIMAX_API_KEY is not configured',
    };
  }

  const model =
    process.env.MINIMAX_MODEL ||
    'MiniMax-M2.7';

  const prompt = `
Review the following prescription-processing outputs.

PRESCRIPTION EXTRACTION:
${JSON.stringify(prescription, null, 2)}

VISUAL DOCUMENT REVIEW:
${JSON.stringify(visualReview, null, 2)}

Return exactly:

{
  "assessment": "consistent | review_recommended | insufficient_information",
  "confidence": "high | medium | low",
  "reasons": [
    "short reason"
  ]
}

Use "review_recommended" only when there is a meaningful contradiction or concern.
Do not claim authenticity has been proven.
`;

  let response;

  try {
    response = await fetch(
      'https://api.minimax.io/v1/chat/completions',
      {
        method: 'POST',

        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },

        body: JSON.stringify({
          model,
          temperature: 0.2,

          messages: [
            {
              role: 'system',
              content: SYSTEM,
            },

            {
              role: 'user',
              content: prompt,
            },
          ],
        }),
      }
    );
  } catch (error) {
    throw new MiniMaxError(
      `Unable to reach MiniMax: ${error.message}`,
      502
    );
  }

  const raw = await response.text();

  let body;

  try {
    body = JSON.parse(raw);
  } catch {
    throw new MiniMaxError(
      'MiniMax returned an unreadable response',
      502
    );
  }

  if (!response.ok) {
    throw new MiniMaxError(
      body?.error?.message ||
      body?.message ||
      'MiniMax request failed',
      response.status
    );
  }

  const content =
    body?.choices?.[0]?.message?.content;

  const parsed =
    extractJson(content);

  const assessments = [
    'consistent',
    'review_recommended',
    'insufficient_information',
  ];

  const confidences = [
    'high',
    'medium',
    'low',
  ];

  return {
    available: true,

    model,

    assessment:
      assessments.includes(parsed.assessment)
        ? parsed.assessment
        : 'insufficient_information',

    confidence:
      confidences.includes(parsed.confidence)
        ? parsed.confidence
        : 'low',

    reasons:
      Array.isArray(parsed.reasons)
        ? parsed.reasons
            .filter(Boolean)
            .slice(0, 8)
            .map(String)
        : [],
  };
}

module.exports = {
  minimaxReview,
  MiniMaxError,
};