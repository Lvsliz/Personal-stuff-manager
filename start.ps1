param(
  [int]$Port = 4173
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)

function Get-ContentType {
  param([string]$Path)

  switch ([System.IO.Path]::GetExtension($Path).ToLowerInvariant()) {
    ".html" { return "text/html; charset=utf-8" }
    ".css" { return "text/css; charset=utf-8" }
    ".js" { return "application/javascript; charset=utf-8" }
    ".json" { return "application/json; charset=utf-8" }
    ".webmanifest" { return "application/manifest+json; charset=utf-8" }
    ".svg" { return "image/svg+xml" }
    ".png" { return "image/png" }
    ".ico" { return "image/x-icon" }
    default { return "application/octet-stream" }
  }
}

function Send-Response {
  param(
    [System.IO.Stream]$Stream,
    [int]$StatusCode,
    [string]$StatusText,
    [byte[]]$Body,
    [string]$ContentType
  )

  $headers = @(
    "HTTP/1.1 $StatusCode $StatusText",
    "Content-Type: $ContentType",
    "Content-Length: $($Body.Length)",
    "Connection: close",
    ""
  ) -join "`r`n"

  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headers + "`r`n")
  $Stream.Write($headerBytes, 0, $headerBytes.Length)
  $Stream.Write($Body, 0, $Body.Length)
}

try {
  $listener.Start()
  Write-Host "Server started at http://localhost:$Port"
  Write-Host "Press Ctrl+C to stop."

  while ($true) {
    $client = $listener.AcceptTcpClient()

    try {
      $stream = $client.GetStream()
      $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
      $requestLine = $reader.ReadLine()

      if ([string]::IsNullOrWhiteSpace($requestLine)) {
        $client.Close()
        continue
      }

      while ($true) {
        $line = $reader.ReadLine()
        if ([string]::IsNullOrEmpty($line)) {
          break
        }
      }

      $parts = $requestLine.Split(" ")
      $method = $parts[0]
      $rawPath = if ($parts.Length -ge 2) { $parts[1] } else { "/" }

      if ($method -ne "GET") {
        $body = [System.Text.Encoding]::UTF8.GetBytes("Method Not Allowed")
        Send-Response -Stream $stream -StatusCode 405 -StatusText "Method Not Allowed" -Body $body -ContentType "text/plain; charset=utf-8"
        $client.Close()
        continue
      }

      $relativePath = $rawPath.Split("?")[0].TrimStart("/")
      if ([string]::IsNullOrWhiteSpace($relativePath)) {
        $relativePath = "index.html"
      }

      $relativePath = $relativePath -replace "/", [System.IO.Path]::DirectorySeparatorChar
      $targetPath = Join-Path $root $relativePath

      if ((Test-Path -LiteralPath $targetPath) -and -not (Get-Item -LiteralPath $targetPath).PSIsContainer) {
        $body = [System.IO.File]::ReadAllBytes($targetPath)
        $contentType = Get-ContentType -Path $targetPath
        Send-Response -Stream $stream -StatusCode 200 -StatusText "OK" -Body $body -ContentType $contentType
      } else {
        $fallbackPath = Join-Path $root "index.html"
        $body = [System.IO.File]::ReadAllBytes($fallbackPath)
        Send-Response -Stream $stream -StatusCode 200 -StatusText "OK" -Body $body -ContentType "text/html; charset=utf-8"
      }

      $client.Close()
    } catch {
      if ($client) {
        $client.Close()
      }
    }
  }
} finally {
  if ($listener) {
    try {
      $listener.Stop()
    } catch {
    }
  }
}
