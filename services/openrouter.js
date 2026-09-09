// services/openrouter.js
//
// OpenRouter wrapper for Dawa-Find AI vision analysis.
//
// Supports:
// 1. Prescription medicine extraction
// 2. Independent prescription document review
// 3. Model overrides for secondary AI checks
// 4. Automatic fallback models
//
// IMPORTANT:
// Never hard-code API keys here.
// Keep OPENROUTER_API_KEY inside the backend .env file.

const OPENROUTER_URL =
  'https://openrouter.ai/api/v1/chat/completions';

/* =========================================================
   DEFAULT MODELS
========================================================= */

const DEFAULT_MODEL =
  'minimax/minimax-m3:free';

const DEFAULT_FALLBACKS = [
  'dots-studio/dots-3-note-preview:free',
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
];

/* =========================================================
   ERROR CLASS
========================================================= */

class OpenRouterError extends Error {
  constructor(message, status) {
    super(message);

    this.name =
      'OpenRouterError';

    this.status =
      status;
  }
}

/* =========================================================
   LOOSE JSON PARSER
========================================================= */

function parseJsonLoose(text) {
  const cleaned =
    String(text || '')
      .replace(
        /<think>[\s\S]*?<\/think>/gi,
        ''
      )
      .replace(
        /^\s*```(?:json)?\s*/i,
        ''
      )
      .replace(
        /\s*```\s*$/i,
        ''
      )
      .trim();

  if (!cleaned) {
    throw new OpenRouterError(
      'Model returned an empty response',
      502
    );
  }

  try {
    return JSON.parse(
      cleaned
    );
  } catch {
    const start =
      cleaned.indexOf('{');

    const end =
      cleaned.lastIndexOf('}');

    if (
      start === -1 ||
      end <= start
    ) {
      throw new OpenRouterError(
        'Model did not return valid JSON',
        502
      );
    }

    try {
      return JSON.parse(
        cleaned.slice(
          start,
          end + 1
        )
      );
    } catch {
      throw new OpenRouterError(
        'Model returned malformed JSON',
        502
      );
    }
  }
}

/* =========================================================
   MODEL CHAIN
========================================================= */

function modelChain(
  requestedModel = null
) {
  /*
   * If a particular model was explicitly requested,
   * use it first.
   */

  const primary =
    requestedModel ||
    process.env.OPENROUTER_MODEL ||
    DEFAULT_MODEL;

  const fallbacks =
    process.env
      .OPENROUTER_FALLBACK_MODELS
      ? process.env
          .OPENROUTER_FALLBACK_MODELS
          .split(',')
          .map(
            (model) =>
              model.trim()
          )
          .filter(Boolean)
      : DEFAULT_FALLBACKS;

  return [
    ...new Set([
      primary,
      ...fallbacks,
    ]),
  ];
}

/* =========================================================
   RESPONSE VALIDATION
========================================================= */

function validateResponse(
  parsed,
  responseType
) {
  if (
    !parsed ||
    typeof parsed !==
      'object' ||
    Array.isArray(parsed)
  ) {
    throw new OpenRouterError(
      'Model returned an unexpected JSON format',
      502
    );
  }

  /*
   * Normal prescription scanner.
   */

  if (
    responseType ===
    'prescription'
  ) {
    if (
      !Array.isArray(
        parsed.medicines
      )
    ) {
      throw new OpenRouterError(
        'Model returned an unexpected prescription format',
        502
      );
    }

    return;
  }

  /*
   * Authenticity/document-quality review.
   */

  if (
    responseType ===
    'document_review'
  ) {
    if (
      typeof parsed
        .classification !==
      'string'
    ) {
      throw new OpenRouterError(
        'Model returned an unexpected document review format',
        502
      );
    }

    return;
  }

  /*
   * Generic JSON response.
   *
   * No additional schema requirement.
   */

  if (
    responseType ===
    'generic'
  ) {
    return;
  }

  throw new OpenRouterError(
    `Unknown OpenRouter response type: ${responseType}`,
    500
  );
}

/* =========================================================
   SINGLE MODEL REQUEST
========================================================= */

async function attempt({
  model,
  apiKey,
  dataUrl,
  system,
  prompt,
  maxTokens,
  responseType,
}) {
  let res;

  try {
    res =
      await fetch(
        OPENROUTER_URL,
        {
          method:
            'POST',

          headers: {
            Authorization:
              `Bearer ${apiKey}`,

            'Content-Type':
              'application/json',

            'HTTP-Referer':
              process.env
                .OPENROUTER_SITE_URL ||
              'http://localhost:5173',

            'X-Title':
              process.env
                .OPENROUTER_APP_NAME ||
              'Dawa-Find',
          },

          body:
            JSON.stringify({
              model,

              max_tokens:
                maxTokens,

              reasoning: {
                enabled:
                  false,
              },

              messages: [
                {
                  role:
                    'system',

                  content:
                    system,
                },

                {
                  role:
                    'user',

                  content: [
                    {
                      type:
                        'image_url',

                      image_url: {
                        url:
                          dataUrl,
                      },
                    },

                    {
                      type:
                        'text',

                      text:
                        prompt,
                    },
                  ],
                },
              ],
            }),
        }
      );
  } catch (err) {
    throw new OpenRouterError(
      `Network error while contacting OpenRouter: ${err.message}`,
      502
    );
  }

  const body =
    await res
      .json()
      .catch(
        () => ({})
      );

  /* =======================================================
     OPENROUTER ERROR
  ======================================================= */

  if (!res.ok) {
    const detail =
      body?.error
        ?.message ||
      body?.error
        ?.code ||
      `HTTP ${res.status}`;

    if (
      res.status ===
        401 ||
      res.status ===
        403
    ) {
      throw new OpenRouterError(
        `OpenRouter authentication failed: ${detail}`,
        500
      );
    }

    throw new OpenRouterError(
      detail,
      res.status
    );
  }

  /* =======================================================
     MODEL RESPONSE
  ======================================================= */

  const message =
    body?.choices?.[0]
      ?.message || {};

  let text =
    message.content ||
    message.reasoning ||
    '';

  /*
   * Some providers may return content as an array.
   */

  if (
    Array.isArray(text)
  ) {
    text =
      text
        .map(
          (part) => {
            if (
              typeof part ===
              'string'
            ) {
              return part;
            }

            return (
              part?.text ||
              ''
            );
          }
        )
        .join('');
  }

  if (!text) {
    throw new OpenRouterError(
      'Model returned an empty response',
      502
    );
  }

  const parsed =
    parseJsonLoose(
      text
    );

  validateResponse(
    parsed,
    responseType
  );

  /*
   * Keep track of which actual model responded.
   */

  parsed._model =
    body?.model ||
    model;

  return parsed;
}

/* =========================================================
   MAIN VISION FUNCTION
========================================================= */

async function visionJson({
  dataUrl,
  system,
  prompt,

  maxTokens = 5000,

  /*
   * Optional explicit model.
   *
   * This allows the authenticity reviewer to request
   * a different model from the main prescription reader.
   */
  model = null,

  /*
   * Supported:
   *
   * prescription
   * document_review
   * generic
   */
  responseType =
    'prescription',

  /*
   * Set false when you want ONLY the explicitly
   * requested model.
   */
  allowFallbacks =
    true,
}) {
  const apiKey =
    process.env
      .OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new OpenRouterError(
      'OPENROUTER_API_KEY is not set in the backend .env file',
      500
    );
  }

  if (!dataUrl) {
    throw new OpenRouterError(
      'Prescription image is missing',
      400
    );
  }

  let models;

  if (
    model &&
    allowFallbacks ===
      false
  ) {
    models = [
      model,
    ];
  } else {
    models =
      modelChain(
        model
      );
  }

  const failures =
    [];

  console.log(
    `[OpenRouter] Task: ${responseType}`
  );

  console.log(
    `[OpenRouter] Trying ${models.length} model(s)...`
  );

  for (
    const currentModel
    of models
  ) {
    console.log(
      `[OpenRouter] Trying model: ${currentModel}`
    );

    try {
      const result =
        await attempt({
          model:
            currentModel,

          apiKey,

          dataUrl,

          system,

          prompt,

          maxTokens,

          responseType,
        });

      console.log(
        `[OpenRouter] Success with model: ${currentModel}`
      );

      return result;
    } catch (err) {
      if (
        !(
          err instanceof
          OpenRouterError
        )
      ) {
        throw err;
      }

      /*
       * Authentication/configuration errors should
       * stop immediately.
       */

      if (
        err.status ===
        500
      ) {
        throw err;
      }

      console.warn(
        `[OpenRouter] ${currentModel} failed: ${err.message}`
      );

      failures.push(
        `${currentModel}: ${err.message}`
      );
    }
  }

  /* =======================================================
     ALL MODELS FAILED
  ======================================================= */

  const allRateLimited =
    failures.length >
      0 &&
    failures.every(
      (failure) =>
        /429|rate|quota|limit|temporarily unavailable|no endpoints/i.test(
          failure
        )
    );

  if (
    allRateLimited
  ) {
    throw new OpenRouterError(
      'All configured AI models are temporarily unavailable or rate-limited. Please try again shortly.',
      429
    );
  }

  throw new OpenRouterError(
    `AI analysis failed: ${failures.join(
      '; '
    )}`,
    502
  );
}

/* =========================================================
   EXPORTS
========================================================= */

module.exports = {
  visionJson,
  OpenRouterError,
  DEFAULT_MODEL,
  DEFAULT_FALLBACKS,
};