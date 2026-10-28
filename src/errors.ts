export class AkbError extends Error {
  constructor(public code: string, message: string, public exitCode = 1) {
    super(message);
  }
}
export function fileError(error: unknown): never {
  if (error instanceof AkbError) throw error;
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'EACCES' || code === 'EPERM') throw new AkbError('PERMISSION_DENIED', 'File permission denied.', 6);
  if (code === 'ENOENT') throw new AkbError('NOT_FOUND', 'File or directory does not exist.', 3);
  if (code === 'EEXIST') throw new AkbError('ALREADY_EXISTS', 'Target already exists; nothing was overwritten.', 5);
  throw new AkbError('IO_ERROR', 'File operation failed; inspect permissions and available disk space.');
}
