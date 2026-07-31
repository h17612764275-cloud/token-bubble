param([string]$DestinationRoot = "")

$ErrorActionPreference = "Stop"
if (-not $DestinationRoot) {
  $DestinationRoot = Join-Path $PSScriptRoot "..\src-tauri\resources"
}
$DestinationRoot = [System.IO.Path]::GetFullPath($DestinationRoot)
$asrDir = Join-Path $DestinationRoot "asr"
$punctuationDir = Join-Path $DestinationRoot "punctuation"
New-Item -ItemType Directory -Force -Path $asrDir, $punctuationDir | Out-Null

$files = @(
  @{ Path = (Join-Path $asrDir "encoder.int8.onnx"); Url = "https://huggingface.co/csukuangfj/sherpa-onnx-streaming-paraformer-bilingual-zh-en/resolve/main/encoder.int8.onnx"; Hash = "81A70226A8934E6ED92AA1D4FC486B428B5398E2F2619ED4897B7294CAB90E9A" },
  @{ Path = (Join-Path $asrDir "decoder.int8.onnx"); Url = "https://huggingface.co/csukuangfj/sherpa-onnx-streaming-paraformer-bilingual-zh-en/resolve/main/decoder.int8.onnx"; Hash = "F3CCA9F77BB9D93C8FCBFB63AE617B6B1EE96818DF3AA3B151C40658FE38594F" },
  @{ Path = (Join-Path $asrDir "tokens.txt"); Url = "https://huggingface.co/csukuangfj/sherpa-onnx-streaming-paraformer-bilingual-zh-en/resolve/main/tokens.txt"; Hash = "59ABA8873A2ED1E122C25FEE421E25F283B63290EFBDE85C1F01A853D83CB6E6" }
)

foreach ($file in $files) {
  if ((Test-Path -LiteralPath $file.Path) -and ((Get-FileHash -Algorithm SHA256 -LiteralPath $file.Path).Hash -eq $file.Hash)) { continue }
  Invoke-WebRequest -UseBasicParsing -Uri $file.Url -OutFile $file.Path
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath $file.Path).Hash -ne $file.Hash) { throw "Voice model hash mismatch: $($file.Path)" }
}

$punctuationPath = Join-Path $punctuationDir "model.int8.onnx"
$punctuationHash = "65A3FB9F5AD7BFB96BF69E0DC4481DF97F6EE60513C1D94CE981BA6EFFD524B1"
if (-not ((Test-Path -LiteralPath $punctuationPath) -and ((Get-FileHash -Algorithm SHA256 -LiteralPath $punctuationPath).Hash -eq $punctuationHash))) {
  $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("token-bubble-punctuation-" + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $tempDir | Out-Null
  try {
    $archive = Join-Path $tempDir "punctuation.tar.bz2"
    Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/k2-fsa/sherpa-onnx/releases/download/punctuation-models/sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8.tar.bz2" -OutFile $archive
    & tar -xjf $archive -C $tempDir
    if ($LASTEXITCODE -ne 0) { throw "Could not extract punctuation model" }
    $model = Get-ChildItem -LiteralPath $tempDir -Filter "model.int8.onnx" -File -Recurse | Select-Object -First 1
    if (-not $model) { throw "Punctuation model is missing from the official archive" }
    Copy-Item -LiteralPath $model.FullName -Destination $punctuationPath -Force
  } finally {
    if (Test-Path -LiteralPath $tempDir) { Remove-Item -LiteralPath $tempDir -Recurse -Force }
  }
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath $punctuationPath).Hash -ne $punctuationHash) { throw "Punctuation model hash mismatch" }
}

Write-Host "Voice models ready at $DestinationRoot"
