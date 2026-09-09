const { visionJson } = require('./openrouter');

const AUTH_SYSTEM = `
You review images of medical prescriptions for document-quality and provenance clues.

You are NOT allowed to declare that a prescription is definitely genuine or definitely fake
based only on pixels.

You may identify visual characteristics that suggest:
- a photographed handwritten/printed clinical document,
- digitally constructed or heavily edited content,
- inconsistent fonts, signatures, stamps or alignment,
- obvious image compositing,
- missing normal prescription structure,
- an image that cannot be assessed reliably.

Do not provide medical advice.
Do not judge whether the prescribed medicines are clinically appropriate.
Return JSON only.
`;

const AUTH_PROMPT = `
Inspect this prescription image.

Return exactly this JSON structure:

{
  "classification": "likely_clinical_document | needs_manual_review | unable_to_determine",
  "confidence": "high | medium | low",
  "signals": [
    "short factual visual observation"
  ],
  "digitalManipulationSignals": [
    "short factual observation"
  ],
  "manualReviewRecommended": boolean
}

Rules:

- Never say "real", "genuine", "fake", or "AI-generated" as a proven fact.
- Image appearance alone cannot prove document origin.
- "likely_clinical_document" means the image visually resembles an ordinary prescription
  and you found no strong visible manipulation signals.
- "needs_manual_review" means you observed enough inconsistencies that a human should check it.
- "unable_to_determine" means image quality or evidence is insufficient.
- Keep signals short.
- Do not invent evidence.
- Do not infer doctor identity.
- Return JSON only.
`;

const VALID_CLASSIFICATIONS = [
  'likely_clinical_document',
  'needs_manual_review',
  'unable_to_determine',
];

const VALID_CONFIDENCE = [
  'high',
  'medium',
  'low',
];

function normalizeReview(review) {
  const classification =
    VALID_CLASSIFICATIONS.includes(review?.classification)
      ? review.classification
      : 'unable_to_determine';

  const confidence =
    VALID_CONFIDENCE.includes(review?.confidence)
      ? review.confidence
      : 'low';

  return {
    classification,
    confidence,

    signals: Array.isArray(review?.signals)
      ? review.signals
          .filter(Boolean)
          .slice(0, 8)
          .map(String)
      : [],

    digitalManipulationSignals:
      Array.isArray(
        review?.digitalManipulationSignals
      )
        ? review.digitalManipulationSignals
            .filter(Boolean)
            .slice(0, 8)
            .map(String)
        : [],

    manualReviewRecommended:
      review?.manualReviewRecommended === true ||
      classification === 'needs_manual_review',
  };
}

async function reviewPrescriptionImage(dataUrl) {
  try {
    const review = await visionJson({
      dataUrl,
      system: AUTH_SYSTEM,
      prompt: AUTH_PROMPT,
      model:
        process.env.OPENROUTER_AUTH_MODEL ||
        process.env.OPENROUTER_MODEL,
      responseType: 'document_review',
      allowFallbacks: true,
    });

    return {
      available: true,
      ...normalizeReview(review),
    };
  } catch (error) {
    console.error(
      'Prescription authenticity review failed:',
      error.message
    );

    return {
      available: false,
      classification: 'unable_to_determine',
      confidence: 'low',
      signals: [],
      digitalManipulationSignals: [],
      manualReviewRecommended: false,
      error: 'Visual review unavailable',
    };
  }
}

module.exports = {
  reviewPrescriptionImage,
};