# WorkBuddy（腾讯 CodeBuddy 系）at-rest 解密密钥扫描器（仅 Windows）。
#
# 新版 WorkBuddy 客户端把 auth.accessToken 等字段以 $wbEncrypted 信封（AES-256-GCM）落盘，
# 解密密钥 = SHA-256(atRestSecretKey)，其中 atRestSecretKey 由客户端内置的原生绑定
# （electron_browser_workbuddy_storage.loggerGet）在启动时构造，仅存在于运行中的客户端进程内存里，
# 磁盘上没有任何副本（~/.workbuddy/keyblob 只包裹非对称「user key」，不含这把对称密钥）。
# 因此只能在客户端运行时从其进程内存里取回该密钥字符串。
#
# 本脚本只做只读内存扫描：遍历 WorkBuddy 进程的已提交内存区，正则匹配安装密钥载荷
# {"version":1,"atRestSecretKey":"<44 字符 base64>"}，把其中的密钥打印到 stdout（仅此一行）。
# 不写任何文件、不修改进程、不结束进程。找不到时以退出码 1 结束。
#
# 供 src/detect/wbcrypto.js 以 `powershell -File` 调用。

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class WbMem {
  [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, IntPtr size, out IntPtr read);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr VirtualQueryEx(IntPtr h, IntPtr addr, out MEMORY_BASIC_INFORMATION mbi, IntPtr len);

  [StructLayout(LayoutKind.Sequential)]
  public struct MEMORY_BASIC_INFORMATION {
    public IntPtr BaseAddress;
    public IntPtr AllocationBase;
    public uint AllocationProtect;
    public IntPtr RegionSize;
    public uint State;
    public uint Protect;
    public uint Type;
  }
}
"@

$pattern = '\{"version":1,"atRestSecretKey":"([A-Za-z0-9+/]{43}=)"'
$mbiSize = [System.Runtime.InteropServices.Marshal]::SizeOf([type][WbMem+MEMORY_BASIC_INFORMATION])
$latin1 = [System.Text.Encoding]::GetEncoding(28591)   # 1 字节 / 1 字符，保持字节偏移不漂移

$procs = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'WorkBuddy' }
foreach ($p in $procs) {
  $h = [WbMem]::OpenProcess(0x410, $false, [uint32]$p.Id)   # PROCESS_QUERY_INFORMATION | PROCESS_VM_READ
  if ($h -eq [IntPtr]::Zero) { continue }
  try {
    $addr = [IntPtr]::Zero
    while ($true) {
      $mbi = New-Object WbMem+MEMORY_BASIC_INFORMATION
      if ([WbMem]::VirtualQueryEx($h, $addr, [ref]$mbi, [IntPtr]$mbiSize) -eq 0) { break }

      # 只读已提交（MEM_COMMIT=0x1000）、可读、非保护页的内存
      $readable = ($mbi.State -eq 0x1000) -and ($mbi.Protect -ne 0) -and ($mbi.Protect -ne 1) -and ($mbi.Protect -ne 0x20) -and (($mbi.Protect -band 0x100) -eq 0)
      $size = [int64]$mbi.RegionSize
      if ($readable -and $size -gt 0 -and $size -lt 268435456) {
        $off = 0
        while ($off -lt $size) {
          $chunk = [Math]::Min(4194304, $size - $off)
          $buf = New-Object byte[] $chunk
          $read = [IntPtr]::Zero
          if (-not [WbMem]::ReadProcessMemory($h, [IntPtr]($addr.ToInt64() + $off), $buf, [IntPtr]$chunk, [ref]$read)) { break }
          $n = [int]$read.ToInt64()
          if ($n -gt 0) {
            $m = [regex]::Match($latin1.GetString($buf, 0, $n), $pattern)
            if ($m.Success) { Write-Output $m.Groups[1].Value; exit 0 }
          }
          $off += $chunk
        }
      }

      $next = $addr.ToInt64() + [int64]$mbi.RegionSize
      if ($next -le $addr.ToInt64()) { break }
      $addr = [IntPtr]$next
    }
  } finally { [WbMem]::CloseHandle($h) | Out-Null }
}
exit 1
