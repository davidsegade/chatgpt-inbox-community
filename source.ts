/** Validate user-controlled GitHub source configuration before constructing API URLs. */
export function sourcePath(repository: string, branch: string): string {
  const name = repository.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/.test(name) || name.split('/')[1].startsWith('.'))
    throw Error('Repository must be owner/name');
  if (!branch || branch.length > 150 || branch.startsWith('/') || branch.endsWith('/') ||
      !/^[A-Za-z0-9][A-Za-z0-9._\/-]*$/.test(branch) ||
      branch.split('/').some(p => !p || p === '.' || p === '..' || p.endsWith('.')) ||
      branch.includes('..') || branch.includes('//') || branch.endsWith('.lock'))
    throw Error('Invalid Git branch');
  return `repos/${name}`;
}
export function inboxPath(branch: string): string {
  return `contents/chatgpt-inbox/requests?ref=${encodeURIComponent(branch)}`;
}
