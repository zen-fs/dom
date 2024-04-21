import { ApiError, ErrorCode } from '@zenfs/core';

/**
 * Converts a DOMException into an ErrorCode
 * @see https://developer.mozilla.org/Web/API/DOMException
 */
function errnoForDOMException(ex: DOMException): keyof typeof ErrorCode {
	switch (ex.name) {
		case 'IndexSizeError':
		case 'HierarchyRequestError':
		case 'InvalidCharacterError':
		case 'InvalidStateError':
		case 'SyntaxError':
		case 'NamespaceError':
		case 'TypeMismatchError':
		case 'ConstraintError':
		case 'VersionError':
		case 'URLMismatchError':
		case 'InvalidNodeTypeError':
			return 'EINVAL';
		case 'WrongDocumentError':
			return 'EXDEV';
		case 'NoModificationAllowedError':
		case 'InvalidModificationError':
		case 'InvalidAccessError':
		case 'SecurityError':
		case 'NotAllowedError':
			return 'EACCES';
		case 'NotFoundError':
			return 'ENOENT';
		case 'NotSupportedError':
			return 'ENOTSUP';
		case 'InUseAttributeError':
			return 'EBUSY';
		case 'NetworkError':
			return 'ENETDOWN';
		case 'AbortError':
			return 'EINTR';
		case 'QuotaExceededError':
			return 'ENOSPC';
		case 'TimeoutError':
			return 'ETIMEDOUT';
		case 'ReadOnlyError':
			return 'EROFS';
		case 'DataCloneError':
		case 'EncodingError':
		case 'NotReadableError':
		case 'DataError':
		case 'TransactionInactiveError':
		case 'OperationError':
		case 'UnknownError':
		default:
			return 'EIO';
	}
}

/**
 * Handles converting errors, then rethrowing them
 */
export function convertException(ex: Error | ApiError | DOMException, path?: string, syscall?: string): ApiError {
	if (ex instanceof ApiError) {
		return ex;
	}

	const code = ex instanceof DOMException ? ErrorCode[errnoForDOMException(ex)] : ErrorCode.EIO;
	const error = new ApiError(code, ex.message, path, syscall);
	error.stack = ex.stack;
	error.cause = ex.cause;
	return error;
}
