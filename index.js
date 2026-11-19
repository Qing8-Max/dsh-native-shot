import { execFile } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Screenshot plugin, host half.
 *
 * The host only grabs pixels; the region picker and the annotation editor run in
 * the browser half. Nothing is written outside %TEMP%, so no screenshot files are
 * left behind.
 *
 *   GET /dsh-native-shot/capture  -> hide our window, grab the screen, restore, return PNG
 *   GET /dsh-native-shot/windows  -> visible app window rectangles, for edge snapping
 */

const CAPTURE_SCRIPT = (pid, outPath, diagPath) => {
  const lines = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    "Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class DshShotWin{[DllImport(\"user32.dll\")]public static extern bool SetProcessDPIAware();[DllImport(\"user32.dll\")]public static extern bool ShowWindow(IntPtr hWnd,int nCmdShow);}'",
    '[DshShotWin]::SetProcessDPIAware() | Out-Null',
    `$diag = @{ pid = ${pid} }`,
    "$win = Get-Process | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero -and $_.MainWindowTitle -match 'DeepSeek|Harness|深度求索' } | Select-Object -First 1",
    `if (-not $win) { $win = Get-Process -Id ${pid} -ErrorAction SilentlyContinue }`,
    '$h = if ($win) { $win.MainWindowHandle } else { [IntPtr]::Zero }',
    '$diag.hwnd = $h.ToInt64()',
    'if ($h -ne [IntPtr]::Zero) { [DshShotWin]::ShowWindow($h, 6) | Out-Null; Start-Sleep -Milliseconds 450 }',
    '$vs = [System.Windows.Forms.SystemInformation]::VirtualScreen',
    '$bmp = New-Object System.Drawing.Bitmap($vs.Width, $vs.Height)',
    '$g = [System.Drawing.Graphics]::FromImage($bmp)',
    '$g.CopyFromScreen($vs.Location, [System.Drawing.Point]::Empty, $vs.Size)',
    `$bmp.Save('${outPath}', [System.Drawing.Imaging.ImageFormat]::Png)`,
    '$g.Dispose()',
    '$bmp.Dispose()',
    'if ($h -ne [IntPtr]::Zero) { [DshShotWin]::ShowWindow($h, 9) | Out-Null }',
    `$diag | ConvertTo-Json -Compress | Set-Content -Path '${diagPath}' -Encoding UTF8`,
  ];
  return lines.join('; ');
};

const WINDOWS_SCRIPT = (pid) =>
  [
    "Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public struct DshShotRect{public int Left;public int Top;public int Right;public int Bottom;}public class DshShotEnum{[DllImport(\"user32.dll\")]public static extern bool SetProcessDPIAware();[DllImport(\"user32.dll\")]public static extern bool GetWindowRect(IntPtr h,out DshShotRect r);}'",
    '[DshShotEnum]::SetProcessDPIAware() | Out-Null',
    '$list = @()',
    `Get-Process | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero -and $_.Id -ne ${pid} } | ForEach-Object { $r = New-Object DshShotRect; if ([DshShotEnum]::GetWindowRect($_.MainWindowHandle, [ref]$r)) { $w = $r.Right - $r.Left; $hh = $r.Bottom - $r.Top; if ($w -gt 80 -and $hh -gt 80) { $list += [pscustomobject]@{ x = $r.Left; y = $r.Top; w = $w; h = $hh } } } }`,
    '$list | ConvertTo-Json -Compress',
  ].join('; ');

function runPowerShell(script, timeoutMs) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: timeoutMs },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(String(stderr || err.message || err).trim()));
          return;
        }
        resolve(String(stdout || ''));
      },
    );
  });
}

async function captureScreen() {
  const id = randomUUID();
  const out = join(tmpdir(), 'dsh-shot-' + id + '.png');
  const diagPath = join(tmpdir(), 'dsh-shot-' + id + '.json');
  const script = CAPTURE_SCRIPT(process.pid, out.replace(/'/g, "''"), diagPath.replace(/'/g, "''"));
  try {
    await runPowerShell(script, 30000);
    return await readFile(out);
  } finally {
    await unlink(out).catch(() => {});
    await unlink(diagPath).catch(() => {});
  }
}

async function listWindows() {
  try {
    const text = (await runPowerShell(WINDOWS_SCRIPT(process.pid), 15000)).trim();
    if (!text) return [];
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

export function apply(ctx) {
  ctx.inject(['webServer'], (c) => {
    c.effect(() => {
      const disposeCapture = c.webServer.register({
        kind: 'exact',
        path: '/dsh-native-shot/capture',
        handler: async (req, res) => {
          try {
            const buf = await captureScreen();
            res.writeHead(200, {
              'content-type': 'image/png',
              'cache-control': 'no-store',
              'content-length': String(buf.length),
            });
            res.end(buf);
          } catch (err) {
            const msg = String((err && err.message) || err);
            res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: msg }));
          }
        },
      });

      const disposeWindows = c.webServer.register({
        kind: 'exact',
        path: '/dsh-native-shot/windows',
        handler: async (req, res) => {
          const list = await listWindows();
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          });
          res.end(JSON.stringify(list));
        },
      });

      return () => {
        disposeCapture();
        disposeWindows();
      };
    });
  });
}