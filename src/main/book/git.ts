import { execFile } from 'node:child_process'

export function git(dir: string, ...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', dir, ...args], { windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(new Error(stderr.trim() || err.message)) : resolve(stdout.trim()))
  })
}

export async function ensureIdentity(dir: string): Promise<void> {
  const has = async (key: string) => (await git(dir, 'config', key).catch(() => '')) !== ''
  if (!(await has('user.name'))) await git(dir, 'config', 'user.name', 'Novel Brain')
  if (!(await has('user.email'))) await git(dir, 'config', 'user.email', 'novelbrain@localhost')
}

export async function commitAll(dir: string, message: string): Promise<string> {
  await git(dir, 'add', '-A')
  await git(dir, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', message)
  return git(dir, 'rev-parse', '--short', 'HEAD')
}
