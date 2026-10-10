/**
 * The HTTP surface: how a response is shaped, and how a request is refused.
 *
 * Two conventions, both borrowed from the routes under `app/api/`:
 *
 *   A **success** is the resource itself, so a caller renders it without unwrapping.
 *   A **failure** is always `{ error: { code, message, ...details } }` with a code that
 *   is stable enough to branch on — `unknown_stream` will never become `bad_stream`.
 *
 * Every failure is explicit about what the caller can do differently; a 500 says it
 * could not be helped rather than dressing an operator error up as a server fault. The
 * status codes are the ones an HTTP client already understands: 400 for a request this
 * API will never accept, 404 for an id that does not resolve, 409 for a request that is
 * valid but cannot be honoured *as state stands* — and 409 is what an unauthorised
 * recycler route is.
 */

const PROBLEM_STATUS = {
  invalid_request: 400,
  unknown_stream: 400,
  pickup_not_found: 404,
  credit_note_not_found: 404,
  pickup_not_settleable: 409,
  no_authorized_recycler: 409,
  // The handoff PIN. Four codes, because the gate says something different for each:
  // "try again" (403), "get a new PIN" (410 expired, 423 locked), or "this load
  // predates PINs" (409).
  pin_mismatch: 403,
  pin_expired: 410,
  pin_locked: 423,
  pin_not_issued: 409,
};

export function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

export function problem(code, message, details = {}) {
  return json(PROBLEM_STATUS[code] ?? 400, {
    error: { code, message, ...details },
  });
}

export function serverError(message, reference) {
  return json(500, {
    error: {
      code: "internal_error",
      message,
      reference: reference ?? null,
    },
  });
}

/** The request body, decoded whether or not API Gateway chose base64. */
export function parseBody(event) {
  const raw = event.body;
  if (raw === null || raw === undefined || raw === "") return {};
  const text = event.isBase64Encoded
    ? Buffer.from(raw, "base64").toString("utf8")
    : raw;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed;
  } catch {
    return null;
  }
}

export function queryParams(event) {
  return event.queryStringParameters ?? {};
}

/**
 * A required non-empty string, trimmed. `max` exists because these values are stored
 * in DynamoDB and echoed back; a 10 KB item code is a bug in the caller, not a load.
 */
export function readString(source, field, { max = 200, required = true } = {}) {
  const value = source?.[field];
  if (value === undefined || value === null || value === "") {
    if (required) return { ok: false, message: `${field} is required` };
    return { ok: true, value: null };
  }
  if (typeof value !== "string") {
    return { ok: false, message: `${field} must be a string` };
  }
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, message: `${field} is required` };
  if (trimmed.length > max) {
    return { ok: false, message: `${field} must be at most ${max} characters` };
  }
  return { ok: true, value: trimmed };
}

/** A required whole number in a range. Mass is grams, so fractions are refused, not rounded. */
export function readInteger(source, field, { min = 1, max = 500000, required = true } = {}) {
  const value = source?.[field];
  if (value === undefined || value === null || value === "") {
    if (required) return { ok: false, message: `${field} is required` };
    return { ok: true, value: null };
  }
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number)) {
    return { ok: false, message: `${field} must be a whole number of grams` };
  }
  if (number < min || number > max) {
    return { ok: false, message: `${field} must be between ${min} and ${max}` };
  }
  return { ok: true, value: number };
}

export function readStringList(source, field, { max = 8, maxLength = 120 } = {}) {
  const value = source?.[field];
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: [] };
  }
  if (!Array.isArray(value)) return { ok: false, message: `${field} must be an array` };
  if (value.length > max) return { ok: false, message: `${field} accepts at most ${max} entries` };
  const entries = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !entry.trim()) {
      return { ok: false, message: `${field} must contain non-empty strings` };
    }
    if (entry.length > maxLength) {
      return { ok: false, message: `${field} entries must be at most ${maxLength} characters` };
    }
    entries.push(entry.trim());
  }
  return { ok: true, value: entries };
}

/** Collects field errors so a caller fixes one request rather than five round trips. */
export function validate(checks) {
  const fields = {};
  const values = {};
  for (const [field, result] of Object.entries(checks)) {
    if (!result.ok) fields[field] = result.message;
    else values[field] = result.value;
  }
  if (Object.keys(fields).length) {
    return { ok: false, response: problem("invalid_request", "The request could not be read", { fields }) };
  }
  return { ok: true, values };
}
