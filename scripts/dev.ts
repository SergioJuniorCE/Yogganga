import { spawn, spawnSync, type ChildProcess } from 'node:child_process'

// Turbo pipes task output, so Expo sees a non-TTY and skips its QR code.
// Run both dev servers directly instead; Expo then prints the interactive QR.
const isWindows = process.platform === 'win32'
const pnpm = isWindows ? 'pnpm.cmd' : 'pnpm'
const children: ChildProcess[] = ['@yogganga/server', '@yogganga/app'].map((name) =>
  spawn(pnpm, ['--filter', name, 'dev'], { stdio: 'inherit', shell: isWindows })
)

let stopping = false
const stop = (): void => {
  if (stopping) return
  stopping = true
  for (const child of children) {
    if (!child.pid) continue
    if (isWindows) spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
    else child.kill('SIGTERM')
  }
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)

for (const child of children) {
  child.on('exit', (code) => {
    if (stopping) return
    process.exitCode = code ?? 1
    stop()
  })
}
