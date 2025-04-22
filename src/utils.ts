import { Exception, Errno } from 'kerium';

/**
 * Converts a DOMException into an Errno
 * @see https://developer.mozilla.org/Web/API/DOMException
 */
function errnoForDOMException(ex: DOMException): keyof typeof Errno {
	switch (ex.name) {
		case 'TypeMismatchError':
			return 'EPERM';
		case 'IndexSizeError':
		case 'HierarchyRequestError':
		case 'InvalidCharacterError':
		case 'InvalidStateError':
		case 'SyntaxError':
		case 'NamespaceError':
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

/** @internal */
export type ConvertException = Exception | DOMException | Error;

/**
 * Handles converting errors, then rethrowing them
 * @internal
 */
export function convertException(ex: ConvertException, path?: string): Exception {
	if (ex instanceof Exception) return ex;

	const code = ex instanceof DOMException ? Errno[errnoForDOMException(ex)] : Errno.EIO;
	const error = new Exception(code, ex.message);
	error.stack = ex.stack!;
	Error.captureStackTrace?.(error, convertException);
	error.cause = ex.cause;
	return error;
}
