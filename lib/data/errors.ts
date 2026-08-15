/**
 * Errors the data-access layer raises, so callers can distinguish "you are not
 * signed in" from "the database rejected this" without inspecting strings.
 */

/** No authenticated user for an operation that requires one. */
export class NotAuthenticatedError extends Error {
  constructor(message = "You must be signed in to do that.") {
    super(message);
    this.name = "NotAuthenticatedError";
  }
}

/** A prerequisite record is missing (e.g. saving preferences before a profile). */
export class MissingProfileError extends Error {
  constructor(message = "Complete your profile before saving preferences.") {
    super(message);
    this.name = "MissingProfileError";
  }
}

/**
 * The database refused the operation.
 *
 * `cause` keeps the original PostgrestError for server logs; `message` stays
 * safe to show a user.
 */
export class DataAccessError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DataAccessError";
  }
}
